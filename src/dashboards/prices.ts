import type { FastifyReply, FastifyRequest } from "fastify";
import { chartQuery } from "./shared/chartQuery.ts";
import { getContext } from "./shared/context.ts";
import { buildChartOptions } from "./shared/chartOptions.ts";
import {
  getProductionTypeIds,
  getProductionTypeOptions,
} from "./shared/productionTypes.ts";
import { metricColor } from "./shared/colors.ts";
import { getPriceSeries } from "./shared/prices.ts";
import { sendChartResponse } from "./shared/chartResponse.ts";
import type {
  AnyRow,
  DashboardParams,
  DashboardQuery,
} from "./shared/types.ts";

export async function prices(
  request: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(request);
  const series = await getPriceSeries(
    request,
    [`${ctx.interval} seconds`, ctx.from, ctx.to, ctx.areaIds, ctx.timezone],
    { colorForMetric: metricColor },
  );
  const options = buildChartOptions(series, "Prices", "price");
  return sendChartResponse(request, reply, options, ctx.timezoneAbbreviation);
}

const captureSql = `
  WITH
  _hourly AS (
    SELECT time_bucket('1h', time) AS time, areas_production_type_id, AVG(g.value) AS value
    FROM generation_data g
    WHERE time BETWEEN $1 AND $2
      AND areas_production_type_id IN(
        SELECT id FROM areas_production_types
        WHERE area_id=ANY($3::int[]) AND production_type_id=ANY($4::int[])
      )
    GROUP BY 1,2
  ),
  _agg AS (
    SELECT
      time_bucket($5::interval, time) AS time,
      a.code||'/'||pt.name AS name,
      SUM(g.value) AS total_kwh,
      SUM(NULLIF(g.value,0)*p.value)/NULLIF(SUM(g.value),0)/100 AS capture_price,
      SUM(NULLIF(g.value,0)*p.value)/NULLIF(SUM(g.value),0)/NULLIF(AVG(p.value),0) AS capture_rate
    FROM _hourly g
    INNER JOIN areas_production_types apt ON(areas_production_type_id=apt.id)
    INNER JOIN areas a ON(area_id=a.id)
    INNER JOIN production_types pt ON(production_type_id=pt.id)
    INNER JOIN prices p USING(area_id,time)
    WHERE time BETWEEN $1 AND $2
      AND area_id=ANY($3::int[])
      AND production_type_id=ANY($4::int[])
    GROUP BY 1,2
  )
  (
    SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $6)*1000 AS time, name, capture_price AS value, 'price' AS type
    FROM _agg
    WHERE total_kwh IS NOT NULL AND total_kwh<>0
  ) UNION (
    SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $6)*1000 AS time, name, capture_rate AS value, 'rate' AS type
    FROM _agg
    WHERE total_kwh IS NOT NULL AND total_kwh<>0
  )
  ORDER BY 2,1
`;

const captureRollingSql = `
  WITH _hourly AS (
    SELECT time_bucket_gapfill('1h', time) AS time, areas_production_type_id, AVG(g.value) AS value
    FROM generation_data g
    WHERE time BETWEEN ($1::timestamptz - interval '12 months') AND $2
      AND areas_production_type_id IN(
        SELECT id FROM areas_production_types
        WHERE area_id=ANY($3::int[]) AND production_type_id=ANY($4::int[])
      )
    GROUP BY 1,2
  )
  SELECT
    EXTRACT(EPOCH FROM time_bucket($5::interval, time) AT TIME ZONE $6)*1000 AS time,
    a.code||'/'||pt.name AS name,
    SUM(SUM(NULLIF(g.value,0)*p.value)/1000) OVER w / NULLIF(SUM(SUM(g.value)/1000) OVER w, 0) /100 AS capture_price,
    SUM(SUM(NULLIF(g.value,0)*p.value)/1000) OVER w / NULLIF(SUM(SUM(g.value)/1000) OVER w, 0) / NULLIF(AVG(AVG(p.value)) OVER w, 0) AS capture_rate
  FROM _hourly g
  INNER JOIN areas_production_types apt ON(areas_production_type_id=apt.id)
  INNER JOIN areas a ON(area_id=a.id)
  INNER JOIN production_types pt ON(production_type_id=pt.id)
  INNER JOIN prices p USING(area_id,time)
  GROUP BY areas_production_type_id,time_bucket($5::interval, time),2
  WINDOW w AS (PARTITION BY areas_production_type_id ORDER BY time_bucket($5::interval, time) RANGE '12 month' PRECEDING)
  ORDER BY 2,1
`;

const captureSummarySql = `
  WITH _hourly AS (
    SELECT time_bucket_gapfill('1h', time) AS time, areas_production_type_id, AVG(g.value) AS value
    FROM generation_data g
    WHERE time BETWEEN $1 AND $2
      AND areas_production_type_id IN(
        SELECT id FROM areas_production_types
        WHERE area_id=ANY($3::int[]) AND production_type_id=ANY($4::int[])
      )
    GROUP BY 1,2
  )
  SELECT
    a.code||'/'||pt.name AS name,
    SUM(NULLIF(g.value,0)*p.value)/NULLIF(SUM(g.value),0)/100 AS capture_price,
    SUM(NULLIF(g.value,0)*p.value)/NULLIF(SUM(g.value),0)/NULLIF(AVG(p.value),0) AS capture_rate,
    SUM(g.value) AS kwh
  FROM _hourly g
  INNER JOIN areas_production_types apt ON(areas_production_type_id=apt.id)
  INNER JOIN areas a ON(area_id=a.id)
  INNER JOIN production_types pt ON(production_type_id=pt.id)
  INNER JOIN prices p USING(area_id,time)
  WHERE time BETWEEN $1 AND $2
  GROUP BY 1
  ORDER BY 1
`;
function getOrCreateSeries(
  series: any[],
  name: string,
  xAxisIndex: number,
  yAxisIndex: number,
  unit: string,
) {
  let existing = series.find(
    (s) => s.name === name && s.xAxisIndex === xAxisIndex,
  );
  if (!existing) {
    existing = {
      name,
      type: "line",
      unit,
      xAxisIndex,
      yAxisIndex,
      symbol: "none",
      lineStyle: { width: 2 },
      data: [],
    };
    series.push(existing);
  }
  return existing;
}

function buildCapturePriceOptions(
  timeSeriesRows: AnyRow[],
  rollingRows: AnyRow[],
  summaryRows: AnyRow[],
) {
  const series: any[] = [];

  for (const row of timeSeriesRows) {
    const isPrice = row.type === "price";
    getOrCreateSeries(
      series,
      `${row.name}${isPrice ? "" : " (rate)"}`,
      isPrice ? 0 : 1,
      isPrice ? 0 : 1,
      isPrice ? "price" : "percent",
    ).data.push([Number(row.time), row.value == null ? null : Number(row.value)]);
  }

  for (const row of rollingRows) {
    getOrCreateSeries(series, String(row.name), 2, 2, "price").data.push([
      Number(row.time),
      row.capture_price == null ? null : Number(row.capture_price),
    ]);
    getOrCreateSeries(series, `${row.name} (rate)`, 3, 3, "percent").data.push([
      Number(row.time),
      row.capture_rate == null ? null : Number(row.capture_rate),
    ]);
  }

  const names = summaryRows.map((row) => String(row.name));
  series.push(
    {
      name: "Capture Price (12M)",
      type: "bar",
      unit: "price",
      xAxisIndex: 4,
      yAxisIndex: 4,
      data: summaryRows.map((row) =>
        row.capture_price == null ? null : Number(row.capture_price),
      ),
      itemStyle: { color: "#5470c6" },
    },
    {
      name: "Capture Rate (12M)",
      type: "bar",
      unit: "percent",
      xAxisIndex: 5,
      yAxisIndex: 5,
      data: summaryRows.map((row) =>
        row.capture_rate == null ? null : Number(row.capture_rate),
      ),
      itemStyle: { color: "#91cc75" },
    },
  );

  return {
    useUTC: true,
    title: { text: "Capture Prices", left: "center", top: 10 },
    tooltip: { trigger: "axis", formatter: { type: "multi" } },
    legend: {
      orient: "horizontal",
      top: 35,
      data: [...new Set(series.map((s) => s.name))],
    },
    grid: [
      { left: "5%", right: "52%", top: "12%", height: "22%", outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
      { left: "52%", right: "5%", top: "12%", height: "22%", outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
      { left: "5%", right: "52%", top: "38%", height: "22%", outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
      { left: "52%", right: "5%", top: "38%", height: "22%", outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
      { left: "5%", right: "52%", top: "64%", height: "22%", outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
      { left: "52%", right: "5%", top: "64%", height: "22%", outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    ],
    xAxis: [
      { type: "time", gridIndex: 0 },
      { type: "time", gridIndex: 1 },
      { type: "time", gridIndex: 2 },
      { type: "time", gridIndex: 3 },
      { type: "value", gridIndex: 4 },
      { type: "value", gridIndex: 5 },
    ],
    yAxis: [
      { type: "value", gridIndex: 0, axisLabel: { formatter: { type: "price" } } },
      { type: "value", gridIndex: 1, axisLabel: { formatter: { type: "percent" } } },
      { type: "value", gridIndex: 2, axisLabel: { formatter: { type: "price" } } },
      { type: "value", gridIndex: 3, axisLabel: { formatter: { type: "percent" } } },
      { type: "category", gridIndex: 4, data: names, inverse: true },
      { type: "category", gridIndex: 5, data: names, inverse: true },
    ],
    series,
  };
}

export async function capturePrice(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const pt = await getProductionTypeIds(ctx.areaIds, req.query.production_type);
  const queryParams = [
    ctx.from,
    ctx.to,
    ctx.areaIds,
    pt,
    `${ctx.interval} seconds`,
    ctx.timezone,
  ];
  const [timeSeriesRows, rollingRows, summaryRows] = await Promise.all([
    chartQuery<AnyRow>(req, captureSql, queryParams),
    chartQuery<AnyRow>(req, captureRollingSql, queryParams),
    chartQuery<AnyRow>(req, captureSummarySql, queryParams.slice(0, 4)),
  ]);

  return sendChartResponse(
    req,
    reply,
    buildCapturePriceOptions(timeSeriesRows, rollingRows, summaryRows),
    ctx.timezoneAbbreviation,
    { production_types: await getProductionTypeOptions(ctx.areaIds) },
    900,
  );
}
