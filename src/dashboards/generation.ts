import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "../lib/db.js";
import {
  calculateInterval,
  getAreaContext,
  buildDualAxisOptions,
  type DashboardParams,
} from "./shared.js";
import {
  buildChartOptions,
  getProductionTypeIds,
  getProductionTypeOptions,
} from "../sharedCharts.js";

type Query = {
  width?: string;
  min_interval?: string;
  production_type?: string;
  transmission?: string;
};
type Row = Record<string, any>;

type BasicQuery = {
  width?: string;
  min_interval?: string;
  production_type?: string;
};
type BasicRow = {
  time: number | string | null;
  metric: string | null;
  value: number | string | null;
};
type Series = {
  name: string;
  type: "line" | "bar";
  unit?: string;
  stack?: string;
  symbol?: string;
  areaStyle?: { opacity: number };
  lineStyle?: Record<string, unknown>;
  itemStyle?: Record<string, unknown>;
  data: Array<[number, number | null]>;
};

const generationSql = `
  WITH _generation_gapfill AS (
    SELECT time_bucket_gapfill($1::interval, time) AS time, a.code AS area, pt.name||'_negative' AS production_type, INTERPOLATE(LEAST(0,AVG(value))) AS value
    FROM generation
    INNER JOIN areas a ON(area_id=a.id)
    INNER JOIN production_types pt ON(production_type_id=pt.id)
    WHERE time BETWEEN $2 AND $3 AND production_type_id = ANY($6::int[]) AND area_id = ANY($4::int[])
    GROUP BY 1,2,3
    UNION
    SELECT time_bucket_gapfill($1::interval, time) AS time, a.code AS area, pt.name AS production_type, INTERPOLATE(GREATEST(0,AVG(value))) AS value
    FROM generation
    INNER JOIN areas a ON(area_id=a.id)
    INNER JOIN production_types pt ON(production_type_id=pt.id)
    WHERE time BETWEEN $2 AND $3 AND production_type_id = ANY($6::int[]) AND area_id = ANY($4::int[])
    GROUP BY 1,2,3
  )
  SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, CONCAT_WS('/', area, production_type) AS metric, SUM(value) AS value
  FROM _generation_gapfill
  GROUP BY 1,area, production_type
  HAVING SUM(value) IS NOT NULL
  ORDER BY 2, 1
`;

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

export async function generation(
  request: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>,
  reply: FastifyReply,
) {
  const ctx = await getAreaContext(request.params);
  const interval = calculateInterval(
    ctx.from,
    ctx.to,
    request.query.width,
    request.query.min_interval,
  );
  const ptIds = await getProductionTypeIds(
    ctx.areaIds,
    request.query.production_type,
  );
  const rows = await querySmall<BasicRow>(generationSql, [
    `${interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
    ptIds,
  ]);
  const productionTypes = await getProductionTypeOptions(ctx.areaIds);
  return sendChart(
    reply,
    buildPowerLineSeries(rows),
    "Generation",
    ctx.timezoneAbbreviation,
    { production_types: productionTypes },
  );
}

export async function generationTotal(
  request: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>,
  reply: FastifyReply,
) {
  const ctx = await getAreaContext(request.params);
  const ptIds = await getProductionTypeIds(
    ctx.areaIds,
    request.query.production_type,
  );
  const rows = await querySmall<BasicRow>(generationTotalSql, [
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
    ptIds,
  ]);
  const series = buildBasicSeries(rows, "bar", true, "energy");
  const productionTypes = await getProductionTypeOptions(ctx.areaIds);
  const options = buildChartOptions(
    series,
    "Generation Total (Daily)",
    "energy",
  );
  return reply
    .header("Cache-Control", "public, max-age=3600")
    .send({
      options,
      height: 567,
      timezone: ctx.timezoneAbbreviation,
      production_types: productionTypes,
    });
}

function buildBasicSeries(
  rows: BasicRow[],
  type: "line" | "bar",
  stacked: boolean,
  unit: string,
  areaColors = false,
): Series[] {
  const byKey = new Map<string, Series>();
  for (const row of rows) {
    if (row.time == null) continue;
    const key = row.metric || "";
    if (!byKey.has(key)) {
      const isNegative = key.endsWith("_negative");
      byKey.set(key, {
        name: key,
        type,
        unit,
        stack: stacked
          ? type === "bar"
            ? isNegative
              ? "negative"
              : "positive"
            : "total"
          : undefined,
        symbol: type === "line" ? "none" : undefined,
        areaStyle: type === "line" && stacked ? { opacity: 0.75 } : undefined,
        lineStyle: type === "line" ? { width: stacked ? 0 : 2 } : undefined,
        itemStyle: { color: areaColors ? areaColor(key) : metricColor(key) },
        data: [],
      });
    }
    byKey
      .get(key)!
      .data.push([
        Number(row.time),
        row.value == null
          ? null
          : Number(row.value) * (unit === "power" ? 1000 : 1),
      ]);
  }
  return [...byKey.values()];
}
function metricColor(metric: string) {
  const key = metric.split("/").at(-1) || metric;
  return (
    {
      "02_nuclear": "rgb(213, 0, 50)",
      "05_gas": "rgb(198, 163, 201)",
      "06_hydro": "rgb(2, 77, 188)",
      "09_wind": "rgb(152, 205, 251)",
      "09_wind_onshore": "rgb(152, 205, 251)",
      "11_solar": "rgb(236, 232, 26)",
    } as Record<string, string>
  )[key];
}
function areaColor(area: string) {
  return (
    (
      {
        SE: "rgba(0, 100, 200, 0.7)",
        NO: "rgba(0, 150, 100, 0.7)",
        DK: "rgba(200, 50, 50, 0.7)",
        FI: "rgba(150, 0, 150, 0.7)",
        DE: "rgba(200, 150, 0, 0.7)",
      } as Record<string, string>
    )[area] || "rgba(150,150,150,0.7)"
  );
}

function buildPowerLineSeries(rows: BasicRow[], areaColors = false) {
  return buildBasicSeries(rows, "line", true, "power", areaColors);
}
async function sendChart(
  reply: FastifyReply,
  series: Series[],
  title: string,
  timezone: string,
  extra = {},
) {
  return reply
    .header("Cache-Control", "public, max-age=3600")
    .send({
      options: buildDualAxisOptions(series, title),
      height: 567,
      timezone,
      ...extra,
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

export async function generationMinMax(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>,
  reply: FastifyReply,
) {
  const ctx = await getAreaContext(req.params);
  const interval = calculateInterval(
    ctx.from,
    ctx.to,
    req.query.width,
    req.query.min_interval,
  );
  const ptIds = await getProductionTypeIds(
    ctx.areaIds,
    req.query.production_type,
  );
  const rows = await querySmall<Row>(generationMinMaxSql, [
    `${interval} seconds`,
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
  );
  return reply.send({
    options,
    height: 567,
    timezone: ctx.timezoneAbbreviation,
    production_types: await getProductionTypeOptions(ctx.areaIds),
  });
}

export async function generationYoy(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>,
  reply: FastifyReply,
) {
  const ctx = await getAreaContext(req.params);
  const interval = calculateYoyInterval(
    req.query.width,
    req.query.min_interval,
  );
  const finish = new Date();
  const ptIds = await getProductionTypeIds(
    ctx.areaIds,
    req.query.production_type,
  );
  const rows = await querySmall<Row>(generationYoySql, [
    `${interval} seconds`,
    finish,
    ctx.areaIds,
    ctx.timezone,
    finish.getFullYear(),
    ptIds,
  ]);
  return reply.send({
    options: buildChartOptions(
      buildYoySeries(rows),
      "Generation Year over Year",
      "power",
    ),
    height: 567,
    timezone: ctx.timezoneAbbreviation,
    production_types: await getProductionTypeOptions(ctx.areaIds),
  });
}

function buildMinMaxSeries(rows: Row[]) {
  return [
    {
      name: "Min",
      type: "line",
      stack: "confidence-band",
      symbol: "none",
      lineStyle: { width: 0 },
      data: rows.map((r) => [Number(r.time), Number(r.min_value)]),
    },
    {
      name: "Max",
      type: "line",
      stack: "confidence-band",
      symbol: "none",
      lineStyle: { width: 0 },
      areaStyle: { color: "rgba(150, 150, 150, 0.3)" },
      data: rows.map((r) => [
        Number(r.time),
        Number(r.max_value) - Number(r.min_value),
      ]),
    },
    {
      name: "Average",
      type: "line",
      symbol: "none",
      lineStyle: { width: 2, color: "rgb(150, 150, 150)" },
      data: rows.map((r) => [Number(r.time), Number(r.avg_value)]),
    },
  ] as any[];
}

function buildYoySeries(rows: Row[]) {
  const m = new Map<string, any>();
  for (const r of rows) {
    const k = String(r.metric);
    if (!m.has(k))
      m.set(k, {
        name: k,
        type: "line",
        symbol: "none",
        lineStyle: { width: 2 },
        data: [],
      });
    m.get(k).data.push([
      Number(r.time),
      r.value == null ? null : Number(r.value) * 1000,
    ]);
  }
  return [...m.values()];
}

function calculateYoyInterval(widthValue?: string, minIntervalValue?: string) {
  const min =
    (
      {
        "1h": 3600,
        "6h": 21600,
        "12h": 43200,
        "1d": 86400,
        "1w": 604800,
        "1M": 2592000,
      } as any
    )[minIntervalValue || "1d"] || 86400;
  const target = 31536000 / Math.max(Number(widthValue || 1000), 1);
  if (target <= min) return min;
  return (
    [3600, 21600, 43200, 86400, 172800, 604800, 2592000]
      .filter((i) => i <= target)
      .at(-1) || min
  );
}

export { simulations } from "./simulation.js";
