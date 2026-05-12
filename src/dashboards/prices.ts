import type { FastifyReply, FastifyRequest } from "fastify";
import { chartQuery } from "./shared/chartQuery.js";
import { calculateInterval } from "./shared/intervals.js";
import { getAreaContext } from "./shared/context.js";
import {
  buildChartOptions,
  buildDualAxisOptions,
} from "./shared/chartOptions.js";
import { buildBasicSeries, buildFieldSeries } from "./shared/series.js";
import {
  getProductionTypeIds,
  getProductionTypeOptions,
} from "./shared/productionTypes.js";
import { metricColor } from "./shared/colors.js";
import { sendChartOptions } from "./shared/chartResponse.js";
import type {
  AnyRow,
  DashboardParams,
  DashboardQuery,
  TimeMetricValueRow,
} from "./shared/types.js";

const pricesSql = `
  SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, metric, value
  FROM (
    SELECT time_bucket_gapfill($1::interval, time) AS time, CONCAT(a.code,'/',a.source) as metric, AVG(p.value)/100 AS value
    FROM prices p
    INNER JOIN areas a ON(p.area_id=a.id)
    WHERE (area_id = ANY($4::int[]) OR area_id IN(SELECT child_id FROM area_associations WHERE parent_id = ANY($4::int[]))) AND time BETWEEN $2 AND $3
    GROUP BY 1,2
    ORDER BY 2,1
  ) s
`;

export async function prices(
  request: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getAreaContext(request.params);
  const interval = calculateInterval(
    ctx.from,
    ctx.to,
    request.query.width,
    request.query.min_interval,
  );
  const rows = await chartQuery<TimeMetricValueRow>(request, pricesSql, [
    `${interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ]);
  const series = buildBasicSeries(rows, "line", false, "price", {
    colorForMetric: metricColor,
  });
  const options = buildChartOptions(series, "Prices", "price");
  return sendChartOptions(reply, options, ctx.timezoneAbbreviation);
}

const captureSql = `WITH _hourly AS (SELECT time_bucket('1h',time) AS time, areas_production_type_id, AVG(g.value) AS value FROM generation_data g WHERE time BETWEEN $1 AND $2 AND areas_production_type_id IN(SELECT id FROM areas_production_types WHERE area_id=ANY($3::int[]) AND production_type_id=ANY($4::int[])) GROUP BY 1,2), _agg AS (SELECT time_bucket($5::interval,time) AS time, a.code||'/'||pt.name AS name, SUM(g.value) AS total_kwh, SUM(NULLIF(g.value,0)*p.value)/NULLIF(SUM(g.value),0)/100 AS capture_price, SUM(NULLIF(g.value,0)*p.value)/NULLIF(SUM(g.value),0)/NULLIF(AVG(p.value),0) AS capture_rate FROM _hourly g INNER JOIN areas_production_types apt ON(areas_production_type_id=apt.id) INNER JOIN areas a ON(area_id=a.id) INNER JOIN production_types pt ON(production_type_id=pt.id) INNER JOIN prices p USING(area_id,time) WHERE time BETWEEN $1 AND $2 GROUP BY 1,2) SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $6)*1000 AS time,name,capture_price,capture_rate FROM _agg WHERE total_kwh IS NOT NULL AND total_kwh<>0 ORDER BY 2,1`;
export async function capturePrice(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getAreaContext(req.params);
  const interval = calculateInterval(
    ctx.from,
    ctx.to,
    req.query.width,
    req.query.min_interval,
  );
  const pt = await getProductionTypeIds(ctx.areaIds, req.query.production_type);
  const rows = await chartQuery<AnyRow>(req, captureSql, [
    ctx.from,
    ctx.to,
    ctx.areaIds,
    pt,
    `${interval} seconds`,
    ctx.timezone,
  ]);
  const series = [
    ...buildFieldSeries(rows, "capture_price", "price"),
    ...buildFieldSeries(rows, "capture_rate", "percent", {
      suffix: " (rate)",
      yAxisIndex: 1,
    }),
  ];
  return reply.send({
    options: buildDualAxisOptions(series, "Capture Prices"),
    height: 900,
    timezone: ctx.timezoneAbbreviation,
    production_types: await getProductionTypeOptions(ctx.areaIds),
  });
}
