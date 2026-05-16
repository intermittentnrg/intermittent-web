import type { FastifyReply, FastifyRequest } from "fastify";
import { chartQuery } from "./shared/chartQuery.js";
import { calculateInterval, calculateYoyInterval } from "./shared/intervals.js";
import { getAreaContext } from "./shared/context.js";
import { buildChartOptions } from "./shared/chartOptions.js";
import {
  buildMinMaxSeries,
  buildPowerLineSeries,
  buildYoySeries,
} from "./shared/series.js";
import { areaColor } from "./shared/colors.js";
import { sendChartResponse, sendDualAxisChart } from "./shared/chartResponse.js";
import type {
  AnyRow,
  DashboardParams,
  DashboardQuery,
  TimeMetricValueRow,
} from "./shared/types.js";

const demandSql = `
  SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, metric, value
  FROM (
    SELECT time_bucket_gapfill($1::interval, time) AS time, a.code AS metric, INTERPOLATE(AVG(value)) AS value
    FROM load l
    INNER JOIN areas a ON(l.area_id = a.id)
    WHERE time BETWEEN $2 AND $3 AND area_id = ANY($4::int[])
    GROUP BY 1, 2
    ORDER BY 2, 1
  ) s
`;

export async function demand(
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
  const rows = await chartQuery<TimeMetricValueRow>(request, demandSql, [
    `${interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ]);
  return sendDualAxisChart(
    request,
    reply,
    buildPowerLineSeries(rows, areaColor),
    "Demand",
    ctx.timezoneAbbreviation,
  );
}

const demandMinMaxSql = `
WITH _full_res AS (
  SELECT time_bucket_gapfill('1 hour', time) AS time, INTERPOLATE(AVG(value)) AS value
  FROM load WHERE time BETWEEN $2 AND $3 AND area_id = ANY($4::int[]) GROUP BY 1, area_id
)
SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, avg_value, min_value, max_value
FROM (
  SELECT time_bucket($1::interval, time) AS time, AVG(value) * 1000 AS avg_value, MIN(value) * 1000 AS min_value, MAX(value) * 1000 AS max_value
  FROM (SELECT time, SUM(value) AS value FROM _full_res GROUP BY time) s
  WHERE value IS NOT NULL GROUP BY 1 ORDER BY 1
) s2`;

const demandYoySql = `
SELECT EXTRACT(EPOCH FROM (time + ($5 - EXTRACT(YEAR FROM time) || ' years')::interval) AT TIME ZONE $4) * 1000 AS time,
       EXTRACT(YEAR FROM time)::text AS metric, SUM(value) AS value
FROM (
  SELECT time_bucket_gapfill($1::interval, time, start => '2015-01-01', finish => $2) AS time, AVG(value) AS value
  FROM load l WHERE time BETWEEN '2015-01-01' AND $2 AND area_id = ANY($3::int[]) GROUP BY 1, area_id
) s
GROUP BY 1, 2 ORDER BY 2, 1`;

export async function demandMinMax(
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
  const rows = await chartQuery<AnyRow>(req, demandMinMaxSql, [
    `${interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ]);
  return sendChartResponse(
    req,
    reply,
    buildChartOptions(
      buildMinMaxSeries(rows),
      "Demand Min/Max",
      "power",
    ),
    ctx.timezoneAbbreviation,
  );
}

export async function demandYoy(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getAreaContext(req.params);
  const interval = calculateYoyInterval(
    req.query.width,
    req.query.min_interval,
  );
  const finish = new Date();
  const rows = await chartQuery<AnyRow>(req, demandYoySql, [
    `${interval} seconds`,
    finish,
    ctx.areaIds,
    ctx.timezone,
    finish.getFullYear(),
  ]);
  return sendChartResponse(
    req,
    reply,
    buildChartOptions(
      buildYoySeries(rows),
      "Demand Year over Year",
      "power",
    ),
    ctx.timezoneAbbreviation,
  );
}
