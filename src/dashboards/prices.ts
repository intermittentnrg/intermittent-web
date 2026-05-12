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
  units?: string;
  nuclear_multiplier?: string;
  wind_multiplier?: string;
  solar_multiplier?: string;
  demand_multiplier?: string;
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
  const rows = await querySmall<BasicRow>(pricesSql, [
    `${interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ]);
  const series = buildBasicSeries(rows, "line", false, "price");
  const options = buildChartOptions(series, "Prices", "price");
  return reply
    .header("Cache-Control", "public, max-age=3600")
    .send({ options, height: 567, timezone: ctx.timezoneAbbreviation });
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

const captureSql = `WITH _hourly AS (SELECT time_bucket('1h',time) AS time, areas_production_type_id, AVG(g.value) AS value FROM generation_data g WHERE time BETWEEN $1 AND $2 AND areas_production_type_id IN(SELECT id FROM areas_production_types WHERE area_id=ANY($3::int[]) AND production_type_id=ANY($4::int[])) GROUP BY 1,2), _agg AS (SELECT time_bucket($5::interval,time) AS time, a.code||'/'||pt.name AS name, SUM(g.value) AS total_kwh, SUM(NULLIF(g.value,0)*p.value)/NULLIF(SUM(g.value),0)/100 AS capture_price, SUM(NULLIF(g.value,0)*p.value)/NULLIF(SUM(g.value),0)/NULLIF(AVG(p.value),0) AS capture_rate FROM _hourly g INNER JOIN areas_production_types apt ON(areas_production_type_id=apt.id) INNER JOIN areas a ON(area_id=a.id) INNER JOIN production_types pt ON(production_type_id=pt.id) INNER JOIN prices p USING(area_id,time) WHERE time BETWEEN $1 AND $2 GROUP BY 1,2) SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $6)*1000 AS time,name,capture_price,capture_rate FROM _agg WHERE total_kwh IS NOT NULL AND total_kwh<>0 ORDER BY 2,1`;
export async function capturePrice(
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
  const pt = await getProductionTypeIds(ctx.areaIds, req.query.production_type);
  const rows = await querySmall<Row>(captureSql, [
    ctx.from,
    ctx.to,
    ctx.areaIds,
    pt,
    `${interval} seconds`,
    ctx.timezone,
  ]);
  const series = [
    ...simpleSeries(rows, "capture_price", "price", 1),
    ...simpleSeries(rows, "capture_rate", "percent", 1, " (rate)", 1),
  ];
  return reply.send({
    options: buildDualAxisOptions(series, "Capture Prices"),
    height: 900,
    timezone: ctx.timezoneAbbreviation,
    production_types: await getProductionTypeOptions(ctx.areaIds),
  });
}
function simpleSeries(
  rows: Row[],
  field: string,
  unit: string,
  mul = 1,
  suffix = "",
  axis = 0,
) {
  const m = new Map<string, any>();
  for (const r of rows) {
    const k = String(r.name) + suffix;
    if (!m.has(k))
      m.set(k, {
        name: k,
        type: "line",
        unit,
        symbol: "none",
        lineStyle: { width: 2 },
        yAxisIndex: axis,
        data: [],
      });
    m.get(k).data.push([
      Number(r.time),
      r[field] == null ? null : Number(r[field]) * mul,
    ]);
  }
  return [...m.values()];
}
