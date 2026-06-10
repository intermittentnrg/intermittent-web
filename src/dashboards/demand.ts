import type { FastifyReply, FastifyRequest } from "fastify";
import { chartQuery } from "./shared/chartQuery.ts";
import { getContext } from "./shared/context.ts";
import { buildXAxisTimestamps } from "./shared/chartOptions.ts";
import {
  buildMinMaxSeries,
  buildPowerLineSeries,
  buildYoySeries,
} from "./shared/series.ts";
import { areaColor } from "./shared/colors.ts";
import { sendUplotResponse } from "./shared/chartResponse.ts";
import { buildUplotPayload } from "./shared/uplotOptions.ts";
import type {
  AnyRow,
  DashboardParams,
  DashboardQuery,
  TimeMetricValueRow,
} from "./shared/types.ts";

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
  const ctx = await getContext(request);
  const rows = await chartQuery<TimeMetricValueRow>(request, demandSql, [
    `${ctx.interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ]);
  const startTime = rows[0]?.time as number | undefined;
  const interval = ctx.interval * 1000;
  const series = buildPowerLineSeries(rows, areaColor);

  if (startTime == null || series.length === 0) {
    return sendUplotResponse(request, reply, {
      chartLibrary: "uplot",
      opts: { title: "Demand", series: [], axes: [] },
      data: [],
      rawData: [],
    });
  }
  const maxLen = series.reduce((max, s) => Math.max(max, s.data?.length ?? 0), 0);
  const timestamps = buildXAxisTimestamps(startTime, interval, maxLen);
  const payload = buildUplotPayload("Demand", timestamps, series, ctx.timezone);
  return sendUplotResponse(request, reply, payload);
}

const demandMinMaxSql = `
WITH _full_res AS (
  SELECT time_bucket_gapfill('1 hour', time) AS time, INTERPOLATE(AVG(value)) AS value
  FROM load WHERE time BETWEEN $2 AND $3 AND area_id = ANY($4::int[]) GROUP BY 1, area_id
)
SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, avg_value, min_value, max_value
FROM (
  SELECT time_bucket($1::interval, time) AS time, AVG(value) AS avg_value, MIN(value) AS min_value, MAX(value) AS max_value
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
  const ctx = await getContext(req);
  const rows = await chartQuery<AnyRow>(req, demandMinMaxSql, [
    `${ctx.interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ]);
  const startTime = rows[0]?.time as number | undefined;
  const interval = ctx.interval * 1000;
  const series = buildMinMaxSeries(rows);

  if (startTime == null || series.length === 0) {
    return sendUplotResponse(req, reply, {
      chartLibrary: "uplot",
      opts: { title: "Demand Min/Max", series: [], axes: [] },
      data: [],
      rawData: [],
    });
  }
  const maxLen = series.reduce((max, s) => Math.max(max, s.data?.length ?? 0), 0);
  const timestamps = buildXAxisTimestamps(startTime, interval, maxLen);
  const payload = buildUplotPayload("Demand Min/Max", timestamps, series, ctx.timezone);
  // Force the y-axis to start at 0 so the confidence band sits on a meaningful baseline
  payload.opts.scales = { y: { range: [0, null] } };
  return sendUplotResponse(req, reply, payload);
}

export async function demandYoy(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const finish = new Date();
  const rows = await chartQuery<AnyRow>(req, demandYoySql, [
    `${ctx.interval} seconds`,
    finish,
    ctx.areaIds,
    ctx.timezone,
    finish.getFullYear(),
  ]);
  const startTime = rows[0]?.time as number | undefined;
  const interval = ctx.interval * 1000;
  const series = buildYoySeries(rows);

  if (startTime == null || series.length === 0) {
    return sendUplotResponse(req, reply, {
      chartLibrary: "uplot",
      opts: { title: "Demand Year over Year", series: [], axes: [] },
      data: [],
      rawData: [],
    });
  }
  const maxLen = series.reduce((max, s) => Math.max(max, s.data?.length ?? 0), 0);
  const timestamps = buildXAxisTimestamps(startTime, interval, maxLen);
  const payload = buildUplotPayload("Demand Year over Year", timestamps, series, ctx.timezone);
  return sendUplotResponse(req, reply, payload);
}
