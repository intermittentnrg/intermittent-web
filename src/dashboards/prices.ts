import type { FastifyReply, FastifyRequest } from "fastify";
import { chartQuery } from "./shared/chartQuery.ts";
import { getContext } from "./shared/context.ts";
import {
  getProductionTypeIds,
  getProductionTypeOptions,
} from "./shared/productionTypes.ts";
import { colorsFromQuery, cyclePalette, PANEL_PALETTE } from "./shared/colors.ts";
import { getPriceSeries } from "./shared/prices.ts";
import { sendUplotResponse } from "./shared/chartResponse.ts";
import type {
  AnyRow,
  DashboardParams,
  DashboardQuery,
} from "./shared/types.ts";
import type { UplotSeriesDesc } from "./shared/uplotOptions.ts";

export async function prices(
  request: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(request);
  // Use cycling palette by default; respect explicit ?colors= override
  const colorFn = request.query.colors
    ? colorsFromQuery(request.query.colors)
    : cyclePalette();
  const series = await getPriceSeries(
    request,
    [`${ctx.interval} seconds`, ctx.from, ctx.to, ctx.areaIds],
    { colorForMetric: colorFn, scale: "price-l" },
  );
  const startTime = ctx.from.getTime() / 1000;
  const interval = ctx.interval;
  const currencySymbol = request.params.region === "australia" ? "$" : "€";

  if (startTime == null || series.length === 0) {
    return sendUplotResponse(request, reply, {
      title: "Prices",
      mainSeries: [],
      startTime: 0,
      interval: 0,
      timezone: ctx.timezone,
    });
  }
  return sendUplotResponse(request, reply, {
    title: "Prices",
    mainSeries: series,
    startTime,
    interval,
    timezone: ctx.timezone,
    currencySymbol,
  });
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
function rowsToPanelSeries(rows: AnyRow[], scale: string): UplotSeriesDesc[] {
  const byName = new Map<string, UplotSeriesDesc>();
  let idx = 0;
  for (const row of rows) {
    const name = String(row.name);
    if (!byName.has(name)) {
      const color = PANEL_PALETTE[idx % PANEL_PALETTE.length];
      idx++;
      const s: UplotSeriesDesc = { label: name, data: [], stroke: color, width: 2 };
      if (scale === "price") s.scale = "price-r";
      if (scale === "percent" || scale === "rate") s.scale = "percent";
      byName.set(name, s);
    }
    const s = byName.get(name)!;
    const raw = row.value;
    if (raw != null) {
      const val = scale === "percent" || scale === "rate" ? Number(raw) * 100 : Number(raw);
      s.data.push(val);
    } else {
      s.data.push(null);
    }
  }
  return [...byName.values()];
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

  // Split timeSeriesRows by type (price vs rate) for panels 0 and 1
  const priceRows = timeSeriesRows.filter((r) => r.type === "price");
  const rateRows = timeSeriesRows.filter((r) => r.type === "rate");

  // Rolling rows — each row has both capture_price and capture_rate
  // Split into panels 2 (price) and 3 (rate)
  const rollingPrice: AnyRow[] = [];
  const rollingRate: AnyRow[] = [];
  for (const row of rollingRows) {
    rollingPrice.push({ ...row, name: row.name, value: row.capture_price });
    rollingRate.push({ ...row, name: row.name, value: row.capture_rate });
  }

  // Summary rows — for panels 4 (price bars) and 5 (rate bars)
  const summaryNames = summaryRows.map((r) => String(r.name));

  const allTimeRows = [...timeSeriesRows, ...rollingRows];
  const startTime = allTimeRows[0]?.time != null ? Number(allTimeRows[0].time) / 1000 : undefined;
  const interval = ctx.interval;

  const productionTypes = await getProductionTypeOptions(ctx.areaIds);
  const currencySymbol = req.params.region === "australia" ? "$" : "€";

  return sendUplotResponse(req, reply, {
    panels: [
      {
        title: "Capture Price",
        mainSeries: rowsToPanelSeries(priceRows, "price"),
        layout: { gridRow: "1", gridColumn: "1" },
        axisSide: 3,
        currencySymbol,
      },
      {
        title: "Capture Rate",
        mainSeries: rowsToPanelSeries(rateRows, "percent"),
        layout: { gridRow: "1", gridColumn: "2" },
        axisSide: 3,
      },
      {
        title: "Rolling Capture Price (12M)",
        mainSeries: rowsToPanelSeries(rollingPrice, "price"),
        layout: { gridRow: "2", gridColumn: "1" },
        axisSide: 3,
        currencySymbol,
      },
      {
        title: "Rolling Capture Rate (12M)",
        mainSeries: rowsToPanelSeries(rollingRate, "percent"),
        layout: { gridRow: "2", gridColumn: "2" },
        axisSide: 3,
      },
      {
        title: "Summary Capture Price",
        mainSeries: summaryRows.map((r, i) => {
          const val = r.capture_price == null ? null : Number(r.capture_price);
          const data = new Array(summaryRows.length).fill(null);
          data[i] = val;
          return { label: String(r.name), data, stroke: PANEL_PALETTE[i % PANEL_PALETTE.length], fill: PANEL_PALETTE[i % PANEL_PALETTE.length], width: 0, type: "bar", scale: "price-l" };
        }),
        layout: { gridRow: "3", gridColumn: "1" },
        xAxisSize: 0,
        scales: { "price-l": { range: [0, null] } },
        currencySymbol,
      },
      {
        title: "Summary Capture Rate",
        mainSeries: summaryRows.map((r, i) => {
          const raw = r.capture_rate;
          const val = raw == null ? null : Number(raw) * 100;
          const data = new Array(summaryRows.length).fill(null);
          data[i] = val;
          return { label: String(r.name), data, stroke: PANEL_PALETTE[i % PANEL_PALETTE.length], fill: PANEL_PALETTE[i % PANEL_PALETTE.length], width: 0, type: "bar", scale: "percent" };
        }),
        layout: { gridRow: "3", gridColumn: "2" },
        xAxisSize: 0,
        scales: { percent: { range: [0, null] } },
      },
    ],
    startTime,
    interval,
    timezone: ctx.timezone,
    layout: { columns: "1fr 1fr", rows: "auto auto auto" },
    height: 900,
  }, { production_types: productionTypes });
}
