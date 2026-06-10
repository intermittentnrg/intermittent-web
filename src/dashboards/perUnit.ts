import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "../lib/db.ts";
import { chartQuery } from "./shared/chartQuery.ts";
import { getContext } from "./shared/context.ts";
import { buildXAxisTimestamps } from "./shared/chartOptions.ts";
import { buildBasicSeries, buildFieldSeries, rowsToSeries } from "./shared/series.ts";
import { getProductionTypeOptions } from "./shared/productionTypes.ts";
import { sendChartResponse, sendUplotResponse } from "./shared/chartResponse.ts";
import { buildUplotPayload } from "./shared/uplotOptions.ts";
import type { AnyRow, DashboardParams, DashboardQuery } from "./shared/types.ts";


async function resolveUnitIds(areaIds: number[], q: DashboardQuery) {
  if (q.units && q.units !== "all")
    return q.units.split(",").map(Number).filter(Boolean);
  if (q.production_type && q.production_type !== "all") {
    const rows = await querySmall<{ id: number }>(
      `SELECT u.id FROM units u INNER JOIN production_types pt ON u.production_type_id=pt.id WHERE pt.name = ANY($1::text[]) AND u.area_id = ANY($2::int[])`,
      [q.production_type.split(","), areaIds],
    );
    return rows.map((r) => r.id);
  }
  const rows = await querySmall<{ id: number }>(
    `SELECT id FROM units WHERE area_id = ANY($1::int[]) LIMIT 200`,
    [areaIds],
  );
  return rows.map((r) => r.id);
}

async function unitMeta(areaIds: number[]) {
  const production_types = await getProductionTypeOptions(areaIds);
  const units = await querySmall<AnyRow>(`
    SELECT u.id, COALESCE(u.name,u.internal_id) AS name, u.internal_id, pt.name AS production_type, a.code AS area
    FROM units u
    INNER JOIN production_types pt ON u.production_type_id=pt.id
    INNER JOIN areas a ON u.area_id=a.id
    WHERE u.area_id = ANY($1::int[]) ORDER BY pt.name,a.code,u.name`,
    [areaIds],
  );
  return { production_types, units };
}

const perUnitSql = `
  SELECT
    EXTRACT(EPOCH FROM time) AS time,
    COALESCE(u.name, u.internal_id) AS metric,
    value
  FROM (
    SELECT
      time_bucket_gapfill($1::interval, time) AS time,
      unit_id,
      INTERPOLATE(AVG(value)) AS value
    FROM generation_unit g
    WHERE
      time BETWEEN $2 AND $3 AND
      unit_id = ANY($4::int[])
    GROUP BY 1,2
    ORDER BY 1,2
  ) s
  INNER JOIN units u ON(unit_id=u.id)
  ORDER BY 2, 1
`;

export async function perUnit(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const unitIds = await resolveUnitIds(ctx.areaIds, req.query);
  const rows = await chartQuery<AnyRow>(req, perUnitSql, [
    `${ctx.interval} seconds`,
    ctx.from,
    ctx.to,
    unitIds,
  ]);
  const startTime = rows[0]?.time as number | undefined;
  const interval = ctx.interval;
  const mainSeries = buildBasicSeries(rows, "line", true, "power", {
    stackForMetric: (metric) =>
      metric.endsWith("_negative") ? "negative" : "total",
  });

  if (startTime == null || mainSeries.length === 0) {
    return sendUplotResponse(req, reply, {
      chartLibrary: "uplot",
      title: "Per Unit",
      mainSeries: [],
      startTime: 0,
      interval: 0,
      timezone: ctx.timezone,
    });
  }
  return sendUplotResponse(req, reply, {
    chartLibrary: "uplot",
    title: "Per Unit",
    mainSeries,
    startTime,
    interval,
    timezone: ctx.timezone,
  }, await unitMeta(ctx.areaIds));
}

const DAILY = 86400;

const perUnitTotalSql = `SELECT EXTRACT(EPOCH FROM time_bucket($4::interval, time)) AS time, CONCAT_WS('/', a.code, pt.name, COALESCE(u.name, u.internal_id))||CASE WHEN SUM(value) < 0 THEN '_negative' ELSE '' END AS metric, SUM(value) AS value FROM (SELECT time_bucket_gapfill('1h', time) AS time, unit_id, AVG(value) AS value FROM generation_unit g WHERE time BETWEEN $1 AND $2 AND unit_id = ANY($3::int[]) GROUP BY 1,2 ORDER BY 1,2) s INNER JOIN units u ON(unit_id=u.id) INNER JOIN areas a ON(u.area_id=a.id) INNER JOIN production_types pt ON(u.production_type_id=pt.id) WHERE time BETWEEN $1 AND $2 GROUP BY 1,a.code,pt.name,u.name,u.internal_id HAVING SUM(value)<>0 ORDER BY 2,1`;

export async function perUnitTotal(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const unitIds = await resolveUnitIds(ctx.areaIds, req.query);
  const rows = await chartQuery<AnyRow>(req, perUnitTotalSql, [
    ctx.from,
    ctx.to,
    unitIds,
    `${DAILY} seconds`,
  ]);
  const startTime = rows[0]?.time as number | undefined;
  const series = buildBasicSeries(rows, "bar", true, "energy");

  if (startTime == null || series.length === 0) {
    return sendUplotResponse(req, reply, {
      chartLibrary: "uplot",
      opts: { title: "Per Unit Total (Daily)", series: [], axes: [] },
      data: [],
      rawData: [],
      startTime: 0,
      interval: 0,
    });
  }
  const maxLen = series.reduce((max, s) => Math.max(max, s.data?.length ?? 0), 0);
  const timestamps = buildXAxisTimestamps(startTime, DAILY, maxLen);
  const payload = buildUplotPayload("Per Unit Total (Daily)", timestamps, series, ctx.timezone);
  return sendUplotResponse(req, reply, payload, await unitMeta(ctx.areaIds));
}

const perUnitPeakSql = `WITH _gen AS (SELECT time_bucket_gapfill($1::interval, time) AS time, unit_id, INTERPOLATE(AVG(value)) AS value FROM generation_unit g WHERE time BETWEEN $2 AND $3 AND unit_id = ANY($4::int[]) GROUP BY 1,2), _peak AS (SELECT unit_id, MAX(value) AS peak_value FROM generation_unit g WHERE unit_id = ANY($4::int[]) AND time BETWEEN ($3::timestamptz - INTERVAL '1 year') AND $3::timestamptz GROUP BY 1) SELECT EXTRACT(EPOCH FROM g.time AT TIME ZONE $5) * 1000 AS time, COALESCE(u.name,u.internal_id) AS metric, g.value / NULLIF(p.peak_value,0) AS value FROM _gen g INNER JOIN _peak p ON g.unit_id=p.unit_id INNER JOIN units u ON g.unit_id=u.id WHERE g.value > 0 ORDER BY 2,1`;

export async function perUnitPeak(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const unitIds = await resolveUnitIds(ctx.areaIds, req.query);
  const rows = await chartQuery<AnyRow>(req, perUnitPeakSql, [
    `${ctx.interval} seconds`,
    ctx.from,
    ctx.to,
    unitIds,
    ctx.timezone,
  ]);
  return sendChartResponse(
    req,
    reply,
    heatmap(rows),
    ctx.timezoneAbbreviation,
    await unitMeta(ctx.areaIds),
  );
}

function heatmap(rows: AnyRow[]) {
  const units = [...new Set(rows.map((r) => String(r.metric)))];
  const times = [...new Set(rows.map((r) => Number(r.time)))].sort(
    (a, b) => a - b,
  );
  const data: any[] = [];
  for (const r of rows) {
    data.push([
      times.indexOf(Number(r.time)),
      units.indexOf(String(r.metric)),
      r.value == null ? null : Math.round(Number(r.value) * 1000) / 10,
    ]);
  }
  return {
    title: { text: "Unit % of Peak Output", left: "center", top: 10 },
    tooltip: { position: "top" },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "10%",
      top: "15%",
      outerBoundsMode: "same",
      outerBoundsContain: "axisLabel",
    },
    xAxis: {
      type: "category",
      data: times,
      splitArea: { show: true },
      axisLabel: { formatter: { type: "date" } },
    },
    yAxis: {
      type: "category",
      data: units,
      splitArea: { show: true },
      inverse: true,
    },
    visualMap: {
      min: 0,
      max: 100,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: "0%",
      inRange: {
        color: ["#FFFFB2", "#FECC5C", "#FD8D3C", "#F03B20", "#BD0026"],
      },
    },
    series: [{ name: "Peak %", type: "heatmap", data, label: { show: false } }],
  };
}

const movingCapSql = `WITH cap AS (SELECT unit_id,LAST(value,time) AS value FROM generation_unit_capacities WHERE time BETWEEN $1 AND $2 AND unit_id=ANY($3::int[]) GROUP BY unit_id), g AS (SELECT time_bucket_gapfill('1h', time) AS time, unit_id, COALESCE(AVG(value),0) AS value FROM generation_unit WHERE time BETWEEN $1 AND $2 AND unit_id=ANY($3::int[]) GROUP BY 1,2) SELECT EXTRACT(EPOCH FROM time_bucket($4::interval,time)) AS time, CONCAT_WS(' - ',u.internal_id,u.name) AS metric, AVG(AVG(g.value)) OVER w / NULLIF(AVG(cap.value),0) AS moving_capacity FROM g INNER JOIN cap USING(unit_id) INNER JOIN units u ON(unit_id=u.id) WHERE time BETWEEN $1 AND $2 GROUP BY unit_id,time_bucket($4::interval,time),2 WINDOW w AS (PARTITION BY unit_id ORDER BY time_bucket($4::interval,time) RANGE '12 month' PRECEDING) ORDER BY 2,1`;
const movingOutputSql = `SELECT EXTRACT(EPOCH FROM time) AS time, metric, value FROM (SELECT time_bucket_gapfill($1::interval,time) AS time, CONCAT_WS(' - ',u.internal_id,u.name,'output') AS metric, AVG(value) AS value FROM generation_unit g INNER JOIN units u ON(unit_id=u.id) WHERE time BETWEEN $2 AND $3 AND unit_id=ANY($4::int[]) GROUP BY 1,u.internal_id,u.name ORDER BY 2,1) s`;
export async function perUnitMovingCapacity(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const unitIds = await resolveUnitIds(ctx.areaIds, req.query);
  const from12 = new Date(ctx.from);
  from12.setMonth(from12.getMonth() - 12);
  const cap = await chartQuery<AnyRow>(req, movingCapSql, [
    from12,
    ctx.to,
    unitIds,
    `${ctx.interval} seconds`,
  ]);
  const out = await chartQuery<AnyRow>(req, movingOutputSql, [
    `${ctx.interval} seconds`,
    ctx.from,
    ctx.to,
    unitIds,
  ]);
  const series = [
    ...buildFieldSeries(cap, "moving_capacity", "percent", {
      nameField: "metric",
      suffix: " (capacity %)",
    }),
    ...buildFieldSeries(out, "value", "power", {
      nameField: "metric",
      scale: "%",
      lineStyle: { width: 2, type: "dashed" },
    }),
  ];
  const t0 = [...cap, ...out].find((r: AnyRow) => r.time != null)?.time as number | undefined;
  const startTime = t0;
  const interval = ctx.interval;

  if (startTime == null || series.length === 0) {
    return sendUplotResponse(req, reply, {
      chartLibrary: "uplot",
      opts: { title: "Per Unit Moving Capacity Factor & Output", series: [], axes: [] },
      data: [],
      rawData: [],
      startTime: 0,
      interval: 0,
    });
  }
  const maxLen = series.reduce((max, s) => Math.max(max, s.data?.length ?? 0), 0);
  const timestamps = buildXAxisTimestamps(startTime, interval, maxLen);
  const payload = buildUplotPayload("Per Unit Moving Capacity Factor & Output", timestamps, series, ctx.timezone);
  return sendUplotResponse(req, reply, payload, await unitMeta(ctx.areaIds));
}


const batterySql = `
WITH rows AS (
  SELECT
    time,
    unit_id,
    value,
    CASE
      WHEN value >  0.5 THEN 'charge'
      WHEN value < -0.5 THEN 'discharge'
      ELSE 'idle'
    END AS event_type
  FROM generation_unit
  WHERE
    time BETWEEN $1 AND $2 AND
    unit_id=ANY($3::int[])
),

active AS (
  SELECT *
  FROM rows
  WHERE event_type <> 'idle'
),

flags AS (
  SELECT
    *,
    CASE
      WHEN lag(event_type) OVER w IS NULL
        OR event_type <> lag(event_type) OVER w
      THEN 1 ELSE 0
    END AS new_event
  FROM active
  WINDOW w AS (
    PARTITION BY unit_id
    ORDER BY time
  )
),

events AS (
  SELECT
    *,
    sum(new_event) OVER (
      PARTITION BY unit_id
      ORDER BY time
    ) AS event_id
  FROM flags
)

SELECT
  EXTRACT(EPOCH FROM min(time)) AS time,
  unit_id,
  event_id,
  event_type,
  min(time) AS event_start,
  max(time) AS event_end,
  sum(value * 5.0 / 60.0) AS energy_mwh,
  count(*) AS intervals
FROM events
GROUP BY unit_id, event_id, event_type
HAVING abs(sum(value * 5.0 / 60.0))>50000
ORDER BY unit_id, event_start
`
export async function perUnitBattery(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const unitIds = await resolveUnitIds(ctx.areaIds, req.query);
  const rows = await chartQuery<AnyRow>(req, batterySql, [
    ctx.from,
    ctx.to,
    unitIds,
  ]);

  const t0 = rows[0]?.time as number | undefined;
  const startTime = t0;
  const interval = ctx.interval;
  const series = rowsToSeries(rows, {
    name: "event_type",
    y: "energy_mwh",
  });

  if (startTime == null || series.length === 0) {
    return sendUplotResponse(req, reply, {
      chartLibrary: "uplot",
      opts: { title: "Battery Events", series: [], axes: [] },
      data: [],
      rawData: [],
      startTime: 0,
      interval: 0,
    });
  }
  const maxLen = series.reduce((max, s) => Math.max(max, s.data?.length ?? 0), 0);
  const timestamps = buildXAxisTimestamps(startTime, interval, maxLen);
  const payload = buildUplotPayload("Battery Events", timestamps, series, ctx.timezone);
  return sendUplotResponse(req, reply, payload, await unitMeta(ctx.areaIds));
}
