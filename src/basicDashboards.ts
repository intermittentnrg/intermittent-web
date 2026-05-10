import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "./lib/db.js";
import { calculateInterval, getAreaContext, buildDualAxisOptions, type DashboardParams } from "./electricityMix.js";

type Query = { width?: string; min_interval?: string; production_type?: string };
type Row = { time: number | string | null; metric: string | null; value: number | string | null };

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

export async function generation(request: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>, reply: FastifyReply) {
  const ctx = await getAreaContext(request.params);
  const interval = calculateInterval(ctx.from, ctx.to, request.query.width, request.query.min_interval);
  const ptIds = await getProductionTypeIds(ctx.areaIds, request.query.production_type);
  const rows = await querySmall<Row>(generationSql, [`${interval} seconds`, ctx.from, ctx.to, ctx.areaIds, ctx.timezone, ptIds]);
  const productionTypes = await getProductionTypeOptions(ctx.areaIds);
  return sendChart(reply, buildPowerLineSeries(rows), "Generation", ctx.timezoneAbbreviation, { production_types: productionTypes });
}

export async function demand(request: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>, reply: FastifyReply) {
  const ctx = await getAreaContext(request.params);
  const interval = calculateInterval(ctx.from, ctx.to, request.query.width, request.query.min_interval);
  const rows = await querySmall<Row>(demandSql, [`${interval} seconds`, ctx.from, ctx.to, ctx.areaIds, ctx.timezone]);
  return sendChart(reply, buildPowerLineSeries(rows, true), "Demand", ctx.timezoneAbbreviation);
}

export async function prices(request: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>, reply: FastifyReply) {
  const ctx = await getAreaContext(request.params);
  const interval = calculateInterval(ctx.from, ctx.to, request.query.width, request.query.min_interval);
  const rows = await querySmall<Row>(pricesSql, [`${interval} seconds`, ctx.from, ctx.to, ctx.areaIds, ctx.timezone]);
  const series = buildBasicSeries(rows, "line", false, "price");
  const options = buildChartOptions(series, "Prices", "price");
  return reply.header("Cache-Control", "public, max-age=3600").send({ options, height: 567, timezone: ctx.timezoneAbbreviation });
}

export async function generationTotal(request: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>, reply: FastifyReply) {
  const ctx = await getAreaContext(request.params);
  const ptIds = await getProductionTypeIds(ctx.areaIds, request.query.production_type);
  const rows = await querySmall<Row>(generationTotalSql, [ctx.from, ctx.to, ctx.areaIds, ctx.timezone, ptIds]);
  const series = buildBasicSeries(rows, "bar", true, "energy");
  const productionTypes = await getProductionTypeOptions(ctx.areaIds);
  const options = buildChartOptions(series, "Generation Total (Daily)", "energy");
  return reply.header("Cache-Control", "public, max-age=3600").send({ options, height: 567, timezone: ctx.timezoneAbbreviation, production_types: productionTypes });
}

export async function emptyDashboard(request: FastifyRequest<{ Params: DashboardParams & { endpoint?: string }; Querystring: Query }>, reply: FastifyReply) {
  const ctx = await getAreaContext(request.params);
  const endpoint = request.params.endpoint || request.params.date_range;
  const title = titleize(endpoint.replace(/_/g, " "));
  return reply.header("Cache-Control", "public, max-age=300").send({
    options: buildChartOptions([], title, "default"),
    height: 567,
    timezone: ctx.timezoneAbbreviation,
    notice: `The ${endpoint} dashboard route is wired, but its SQL has not been ported yet.`,
  });
}

async function sendChart(reply: FastifyReply, series: Series[], title: string, timezone: string, extra = {}) {
  return reply.header("Cache-Control", "public, max-age=3600").send({ options: buildDualAxisOptions(series, title), height: 567, timezone, ...extra });
}

function buildPowerLineSeries(rows: Row[], areaColors = false) {
  return buildBasicSeries(rows, "line", true, "power", areaColors);
}

function buildBasicSeries(rows: Row[], type: "line" | "bar", stacked: boolean, unit: string, areaColors = false): Series[] {
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
        stack: stacked ? (type === "bar" ? (isNegative ? "negative" : "positive") : "total") : undefined,
        symbol: type === "line" ? "none" : undefined,
        areaStyle: type === "line" && stacked ? { opacity: 0.75 } : undefined,
        lineStyle: type === "line" ? { width: stacked ? 0 : 2 } : undefined,
        itemStyle: { color: areaColors ? areaColor(key) : metricColor(key) },
        data: [],
      });
    }
    byKey.get(key)!.data.push([Number(row.time), row.value == null ? null : Number(row.value) * (unit === "power" ? 1000 : 1)]);
  }
  return [...byKey.values()];
}

function buildChartOptions(series: Series[], title: string, formatterType: string) {
  return {
    useUTC: true,
    title: { text: title, left: "center", top: 10 },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" }, formatter: { type: formatterType } },
    legend: { type: "scroll", orient: "horizontal", top: 40, data: [...new Set(series.map((s) => s.name))] },
    grid: { left: "3%", right: "4%", bottom: "3%", top: "18%", containLabel: true },
    xAxis: { type: "time", boundaryGap: false },
    yAxis: { type: "value", axisLabel: { formatter: { type: formatterType } } },
    series,
  };
}

async function getProductionTypeIds(areaIds: number[], productionType?: string) {
  if (productionType && productionType !== "all") {
    const rows = await querySmall<{ id: number }>("SELECT id FROM production_types WHERE name = ANY($1::text[])", [productionType.split(",")]);
    return rows.map((row) => row.id);
  }
  const rows = await querySmall<{ production_type_id: number }>("SELECT DISTINCT production_type_id FROM areas_production_types WHERE area_id = ANY($1::int[])", [areaIds]);
  return rows.map((row) => row.production_type_id);
}

async function getProductionTypeOptions(areaIds: number[]) {
  const rows = await querySmall<{ name: string }>(
    "SELECT DISTINCT pt.name FROM production_types pt INNER JOIN areas_production_types apt ON apt.production_type_id=pt.id WHERE apt.area_id = ANY($1::int[]) ORDER BY pt.name",
    [areaIds],
  );
  return [{ value: "all", label: "All" }, ...rows.map((row) => ({ value: row.name, label: titleize(row.name) }))];
}

function titleize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function metricColor(metric: string) {
  const key = metric.split("/").at(-1) || metric;
  return ({ "02_nuclear": "rgb(213, 0, 50)", "05_gas": "rgb(198, 163, 201)", "06_hydro": "rgb(2, 77, 188)", "09_wind": "rgb(152, 205, 251)", "09_wind_onshore": "rgb(152, 205, 251)", "11_solar": "rgb(236, 232, 26)" } as Record<string, string>)[key];
}

function areaColor(area: string) {
  return ({ SE: "rgba(0, 100, 200, 0.7)", NO: "rgba(0, 150, 100, 0.7)", DK: "rgba(200, 50, 50, 0.7)", FI: "rgba(150, 0, 150, 0.7)", DE: "rgba(200, 150, 0, 0.7)" } as Record<string, string>)[area] || "rgba(150,150,150,0.7)";
}
