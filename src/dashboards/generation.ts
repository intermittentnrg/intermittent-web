import type { FastifyReply, FastifyRequest } from "fastify";
import { chartQuery } from "./shared/chartQuery.ts";
import { getContext } from "./shared/context.ts";
import {
  buildBasicSeries,
  buildMinMaxSeries,
  buildPowerLineSeries,
  buildYoySeries,
} from "./shared/series.ts";
import {
  getProductionTypeIds,
  getProductionTypeOptions,
} from "./shared/productionTypes.ts";
import { cyclePalette } from "./shared/colors.ts";
import { sendUplotResponse } from "./shared/chartResponse.ts";
import { getPriceSeries } from "./shared/prices.ts";
import { getLoadSeries } from "./shared/load.ts";
import type {
  AnyRow,
  DashboardParams,
  DashboardQuery,
  TimeMetricValueRow,
} from "./shared/types.ts";

const generationSql = `
  WITH _generation_gapfill AS (
    SELECT
      time_bucket_gapfill($1::interval, time) AS time,
      a.code AS area,
      pt.name AS production_type,
      INTERPOLATE(AVG(value)) AS value
    FROM generation
    INNER JOIN areas a ON(area_id=a.id)
    INNER JOIN production_types pt ON(production_type_id=pt.id)
    WHERE
      time BETWEEN $2 AND $3 AND
      production_type_id = ANY($5::int[]) AND
      area_id = ANY($4::int[])
    GROUP BY 1,2,3
  )
  SELECT EXTRACT(EPOCH FROM time) AS time, CONCAT_WS('/', area, production_type) AS metric, SUM(value) AS value
  FROM _generation_gapfill
  GROUP BY 1,area, production_type
  HAVING SUM(value) IS NOT NULL
  ORDER BY 2, 1
`;

export async function generation(
  request: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(request);
  const ptIds = await getProductionTypeIds(
    ctx.areaIds,
    request.query.production_type,
  );
  const priceArgs: [string, Date, Date, number[]] = [
    `${ctx.interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
  ];
  const rows = await chartQuery<TimeMetricValueRow>(request, generationSql, [
    ...priceArgs,
    ptIds,
  ]);
  const palette = cyclePalette();
  const stackedSeries = buildPowerLineSeries(rows, (metric: string) => palette(metric));
  const loadSeries = request.query.load ? await getLoadSeries(request, priceArgs) : [];
  const priceSeries = request.query.prices ? await getPriceSeries(request, priceArgs, { scale: "price-r" }) : [];
  const startTime = rows[0]?.time as number | undefined;
  const interval = ctx.interval;

  if (startTime == null || (stackedSeries.length === 0 && loadSeries.length === 0 && priceSeries.length === 0)) {
    return sendUplotResponse(request, reply, {
      title: "Generation",
      stackedSeries: [],
      startTime: 0,
      interval: 0,
      timezone: ctx.timezone,
    });
  }
  const productionTypes = await getProductionTypeOptions(ctx.areaIds);
  const currencySymbol = request.params.region === "australia" ? "$" : "€";
  return sendUplotResponse(request, reply, {
    title: "Generation",
    stackedSeries,
    extraSeries: [...loadSeries, ...priceSeries],
    startTime,
    interval,
    timezone: ctx.timezone,
    currencySymbol,
  }, { production_types: productionTypes });
}

const DAILY = 86400;

const generationTotalSql = `
  SELECT EXTRACT(EPOCH FROM time_bucket($5::interval, time)) AS time, CONCAT_WS('/', area, production_type) AS metric, SUM(value) AS value
  FROM (
    SELECT time_bucket_gapfill('1h', time) AS time, a.code AS area, pt.name AS production_type, AVG(value) AS value
    FROM generation
    INNER JOIN areas a ON(area_id = a.id)
    INNER JOIN production_types pt ON(production_type_id = pt.id)
    WHERE time BETWEEN $1 AND $2 AND production_type_id = ANY($4::int[]) AND area_id = ANY($3::int[])
    GROUP BY 1, 2, 3
  ) AS hourly_data
  GROUP BY 1, 2
  HAVING SUM(value) <> 0
  ORDER BY 2, 1
`;

export async function generationTotal(
  request: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(request);
  const ptIds = await getProductionTypeIds(
    ctx.areaIds,
    request.query.production_type,
  );
  const rows = await chartQuery<TimeMetricValueRow>(request, generationTotalSql, [
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ptIds,
    `${DAILY} seconds`,
  ]);
  const palette = cyclePalette();
  const series = buildBasicSeries(rows, "bar", true, "energy", {
    colorForMetric: (metric: string) => palette(metric),
  });
  const startTime = rows[0]?.time as number | undefined;

  if (startTime == null || series.length === 0) {
    return sendUplotResponse(request, reply, {
      title: "Generation Total (Daily)",
      stackedSeries: [],
      startTime: 0,
      interval: 0,
      timezone: ctx.timezone,
    });
  }
  const productionTypes = await getProductionTypeOptions(ctx.areaIds);
  return sendUplotResponse(request, reply, {
    title: "Generation Total (Daily)",
    stackedSeries: series,
    startTime,
    interval: DAILY,
    timezone: ctx.timezone,
    noLabels: true,
  }, { production_types: productionTypes });
}

const generationMinMaxSql = `
WITH _full_res AS (
  SELECT time_bucket_gapfill('15 minutes', time) AS time, INTERPOLATE(AVG(value)) AS value
  FROM generation
  WHERE time BETWEEN $2 AND $3 AND production_type_id = ANY($5::int[]) AND area_id = ANY($4::int[])
  GROUP BY 1, area_id, production_type_id
)
SELECT EXTRACT(EPOCH FROM time) AS time, avg_value, min_value, max_value
FROM (
  SELECT time_bucket($1::interval, time) AS time, AVG(value) AS avg_value, MIN(value) AS min_value, MAX(value) AS max_value
  FROM (SELECT time, SUM(value) AS value FROM _full_res GROUP BY time) s
  WHERE value IS NOT NULL GROUP BY 1 ORDER BY 1
) s2`;

export async function generationMinMax(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const ptIds = await getProductionTypeIds(
    ctx.areaIds,
    req.query.production_type,
  );
  const rows = await chartQuery<AnyRow>(req, generationMinMaxSql, [
    `${ctx.interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ptIds,
  ]);
  const startTime = rows[0]?.time as number | undefined;
  const interval = ctx.interval;
  const [min, max, avg] = buildMinMaxSeries(rows);

  if (startTime == null || !min || !max || !avg) {
    return sendUplotResponse(req, reply, {
      title: "Generation Min/Max",
      stackedSeries: [],
      startTime: 0,
      interval: 0,
      timezone: ctx.timezone,
    });
  }
  const productionTypes = await getProductionTypeOptions(ctx.areaIds);
  return sendUplotResponse(req, reply, {
    title: "Generation Min/Max",
    stackedSeries: [min, max],
    extraSeries: [avg],
    startTime,
    interval,
    timezone: ctx.timezone,
    scales: { y: { range: [0, null] } },
  }, { production_types: productionTypes });
}

const generationYoySql = `
SELECT EXTRACT(EPOCH FROM (time + ($4 - EXTRACT(YEAR FROM time) || ' years')::interval)) AS time,
       EXTRACT(YEAR FROM time)::text AS metric, SUM(value) AS value
FROM (
  SELECT time_bucket_gapfill($1::interval, time, start => '2015-01-01', finish => $2) AS time, AVG(value) AS value
  FROM generation_data_hourly g
  INNER JOIN areas_production_types apt ON g.areas_production_type_id = apt.id
  WHERE time BETWEEN '2015-01-01' AND $2 AND apt.production_type_id = ANY($5::int[]) AND apt.area_id = ANY($3::int[])
  GROUP BY 1, apt.area_id, apt.production_type_id
) s
GROUP BY 1, 2 ORDER BY 2, 1`;

export async function generationYoy(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const finish = new Date();
  const ptIds = await getProductionTypeIds(
    ctx.areaIds,
    req.query.production_type,
  );
  const rows = await chartQuery<AnyRow>(req, generationYoySql, [
    `${ctx.interval} seconds`,
    finish,
    ctx.areaIds,
    finish.getFullYear(),
    ptIds,
  ]);
  const startTime = rows[0]?.time as number | undefined;
  const interval = ctx.interval;
  const series = buildYoySeries(rows);

  if (startTime == null || series.length === 0) {
    return sendUplotResponse(req, reply, {
      title: "Generation Year over Year",
      stackedSeries: [],
      startTime: 0,
      interval: 0,
      timezone: ctx.timezone,
    });
  }
  const productionTypes = await getProductionTypeOptions(ctx.areaIds);
  return sendUplotResponse(req, reply, {
    title: "Generation Year over Year",
    extraSeries: series,
    startTime,
    interval,
    timezone: ctx.timezone,
    scales: { y: { range: [0, null] } },
  }, { production_types: productionTypes });
}

export { simulation } from "./simulation.ts";
