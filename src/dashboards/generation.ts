import type { FastifyReply, FastifyRequest } from "fastify";
import { chartQuery } from "./shared/chartQuery.ts";
import { getContext } from "./shared/context.ts";
import { buildChartOptions } from "./shared/chartOptions.ts";
import {
  buildBasicSeries,
  buildMinMaxSeries,
  buildPowerLineSeries,
  buildYoySeries,
  divergentSeries,
} from "./shared/series.ts";
import {
  getProductionTypeIds,
  getProductionTypeOptions,
} from "./shared/productionTypes.ts";
import { metricColor } from "./shared/colors.ts";
import {
  sendChartResponse,
  sendDualAxisChart,
} from "./shared/chartResponse.ts";
import { getPriceSeries } from "./shared/prices.ts";
import { getLoadSeries } from "./shared/load.ts";
import type {
  AnyRow,
  DashboardParams,
  DashboardQuery,
  Series,
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
      production_type_id = ANY($6::int[]) AND
      area_id = ANY($4::int[])
    GROUP BY 1,2,3
  )
  SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, CONCAT_WS('/', area, production_type) AS metric, SUM(value) AS value
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
  const priceArgs: [string, Date, Date, number[], string] = [
    `${ctx.interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ];
  const rows = await chartQuery<TimeMetricValueRow>(request, generationSql, [
    ...priceArgs,
    ptIds,
  ]);
  const series: Series[] = divergentSeries(buildPowerLineSeries(rows, metricColor));
  if (request.query.load) {
    series.push(...(await getLoadSeries(request, priceArgs)));
  }
  if (request.query.prices) series.push(...(await getPriceSeries(request, priceArgs, { yAxisIndex: 1 })));
  const productionTypes = await getProductionTypeOptions(ctx.areaIds);
  return sendDualAxisChart(
    request,
    reply,
    series,
    "Generation",
    ctx.timezoneAbbreviation,
    { production_types: productionTypes },
  );
}

const generationTotalSql = `
  SELECT EXTRACT(EPOCH FROM time_bucket('1d', time) AT TIME ZONE $4) * 1000 AS time, CONCAT_WS('/', area, production_type) AS metric, SUM(value)*1000 AS value
  FROM (
    SELECT time_bucket_gapfill('1h', time) AS time, a.code AS area, pt.name AS production_type, AVG(GREATEST(0, value)) AS value
    FROM generation
    INNER JOIN areas a ON(area_id = a.id)
    INNER JOIN production_types pt ON(production_type_id = pt.id)
    WHERE time BETWEEN $1 AND $2 AND production_type_id = ANY($5::int[]) AND area_id = ANY($3::int[])
    GROUP BY 1, 2, 3
    UNION
    SELECT time_bucket_gapfill('1h', time) AS time, a.code AS area, CONCAT(pt.name, '_negative') AS production_type, AVG(LEAST(0, value)) AS value
    FROM generation
    INNER JOIN areas a ON(area_id = a.id)
    INNER JOIN production_types pt ON(production_type_id = pt.id)
    WHERE time BETWEEN $1 AND $2 AND production_type_id = ANY($5::int[]) AND area_id = ANY($3::int[])
    GROUP BY 1, 2, 3
  ) AS hourly_data
  WHERE time BETWEEN $1 AND $2
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
    ctx.timezone,
    ptIds,
  ]);
  const series = buildBasicSeries(rows, "bar", true, "energy", {
    colorForMetric: metricColor,
  });
  const productionTypes = await getProductionTypeOptions(ctx.areaIds);
  const options = buildChartOptions(
    series,
    "Generation Total (Daily)",
    "energy",
  );
  return sendChartResponse(request, reply, options, ctx.timezoneAbbreviation, {
    production_types: productionTypes,
  });
}

const generationMinMaxSql = `
WITH _full_res AS (
  SELECT time_bucket_gapfill('15 minutes', time) AS time, INTERPOLATE(AVG(value)) AS value
  FROM generation
  WHERE time BETWEEN $2 AND $3 AND production_type_id = ANY($6::int[]) AND area_id = ANY($4::int[])
  GROUP BY 1, area_id, production_type_id
)
SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, avg_value, min_value, max_value
FROM (
  SELECT time_bucket($1::interval, time) AS time, AVG(value) * 1000 AS avg_value, MIN(value) * 1000 AS min_value, MAX(value) * 1000 AS max_value
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
    ctx.timezone,
    ptIds,
  ]);
  const options = buildChartOptions(
    buildMinMaxSeries(rows),
    "Generation Min/Max",
    "power",
    false,
  );
  return sendChartResponse(req, reply, options, ctx.timezoneAbbreviation, {
    production_types: await getProductionTypeOptions(ctx.areaIds),
  });
}

const generationYoySql = `
SELECT EXTRACT(EPOCH FROM (time + ($5 - EXTRACT(YEAR FROM time) || ' years')::interval) AT TIME ZONE $4) * 1000 AS time,
       EXTRACT(YEAR FROM time)::text AS metric, SUM(value) AS value
FROM (
  SELECT time_bucket_gapfill($1::interval, time, start => '2015-01-01', finish => $2) AS time, AVG(value) AS value
  FROM generation_data_hourly g
  INNER JOIN areas_production_types apt ON g.areas_production_type_id = apt.id
  WHERE time BETWEEN '2015-01-01' AND $2 AND apt.production_type_id = ANY($6::int[]) AND apt.area_id = ANY($3::int[])
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
    ctx.timezone,
    finish.getFullYear(),
    ptIds,
  ]);
  return sendChartResponse(
    req,
    reply,
    buildChartOptions(
      buildYoySeries(rows),
      "Generation Year over Year",
      "power",
    ),
    ctx.timezoneAbbreviation,
    { production_types: await getProductionTypeOptions(ctx.areaIds) },
  );
}

export { simulation } from "./simulation.ts";
