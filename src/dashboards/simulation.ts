import type { FastifyReply, FastifyRequest } from "fastify";
import { chartQuery } from "./shared/chartQuery.ts";
import { getContext } from "./shared/context.ts";
import { sendChartResponse } from "./shared/chartResponse.ts";
import {
  buildStackedPowerLineSeries,
  divergentSeries,
} from "./shared/series.ts";
import {
  getProductionTypeIds,
  getProductionTypeOptions,
} from "./shared/productionTypes.ts";
import { colorsFromQuery } from "./shared/colors.ts";
import { formatEnergy } from "../shared/echartsFormatters.ts";
import type { AnyRow, DashboardParams, DashboardQuery } from "./shared/types.ts";


export async function simulation(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const pt = await getProductionTypeIds(ctx.areaIds, req.query.production_type);
  const mult = {
    nuclear: Number(req.query.nuclear_multiplier || 1),
    wind: Number(req.query.wind_multiplier || 1),
    solar: Number(req.query.solar_multiplier || 1),
    demand: Number(req.query.demand_multiplier || 1),
  };
  const includeTransmission = req.query.transmission !== "0";
  const transmissionCte = includeTransmission ? `,

_transmission AS (
  SELECT
    time,
    CASE WHEN SUM(value)<0 THEN 'export' ELSE 'import' END AS metric,
    SUM(value) AS value
  FROM (
    (
      SELECT
        time_bucket_gapfill('1h'::interval,time) AS time,
        from_area_id,
        to_area_id,
        INTERPOLATE(AVG(t.value)) AS value
      FROM transmission_data t
      INNER JOIN areas_areas aa ON(t.areas_area_id=aa.id)
      WHERE
        aa.from_area_id=ANY($3::int[]) AND
        NOT (aa.to_area_id=ANY($3::int[])) AND
        time BETWEEN $1 AND $2
      GROUP BY 1,2,3
    ) UNION (
      SELECT
        time_bucket_gapfill('1h'::interval,time) AS time,
        to_area_id AS from_area_id,
        from_area_id AS to_area_id,
        INTERPOLATE(-AVG(t.value)) AS value
      FROM transmission_data t
      INNER JOIN areas_areas aa ON(t.areas_area_id=aa.id)
      WHERE
        aa.to_area_id=ANY($3::int[]) AND
        NOT (aa.from_area_id=ANY($3::int[])) AND
        time BETWEEN $1 AND $2
      GROUP BY 1,2,3
    )
  ) s
  INNER JOIN areas from_area ON(from_area_id=from_area.id)
  INNER JOIN areas to_area ON(to_area_id=to_area.id)
  WHERE
    (from_area.type <> 'country' OR to_area.type='country')
  GROUP BY 1
)` : ``;
  const transmissionSelect = includeTransmission ? "COALESCE(t.value,0)" : "0";
  const transmissionJoin = includeTransmission ? "\nLEFT JOIN _transmission t USING(time)" : "";
  const summarySql = `
WITH _generation AS (
  SELECT
    time,
    'generation' AS metric,
    SUM(value) AS value
  FROM (
    SELECT
      time_bucket_gapfill('1h'::interval,time) AS time,
      pt.name AS production_type,
      INTERPOLATE(CASE WHEN pt.name='nuclear' THEN AVG(g.value)*$5 WHEN pt.name LIKE 'wind%' THEN AVG(g.value)*$6 WHEN pt.name LIKE 'solar%' THEN AVG(g.value)*$7 ELSE AVG(g.value) END) AS value
    FROM generation_data g
    INNER JOIN areas_production_types apt ON(g.areas_production_type_id=apt.id)
    INNER JOIN production_types pt ON(apt.production_type_id=pt.id)
    WHERE
      time BETWEEN $1 AND $2 AND
      apt.area_id=ANY($3::int[]) AND
      apt.production_type_id=ANY($8::int[])
    GROUP BY 1,pt.name,apt.area_id
  ) s
  GROUP BY 1
),

_load AS (
  SELECT
    time,
    'load' AS metric,
    SUM(value)*$9 AS value
  FROM (
    SELECT
      time_bucket_gapfill('1h'::interval,time) AS time,
      INTERPOLATE(AVG(l.value)) AS value
    FROM load l
    WHERE
      time BETWEEN $1 AND $2 AND
      area_id=ANY($3::int[])
    GROUP BY 1

    UNION

    SELECT
      time_bucket_gapfill('1h'::interval,time) AS time,
      INTERPOLATE(AVG(g.value)) AS value
    FROM generation_data g
    INNER JOIN areas_production_types apt ON(g.areas_production_type_id=apt.id)
    INNER JOIN production_types pt ON(apt.production_type_id=pt.id)
    INNER JOIN areas a ON(apt.area_id=a.id)
    WHERE
      time BETWEEN $1 AND $2 AND
      apt.area_id=ANY($3::int[]) AND
      pt.name='solar_rooftop' AND
      a.source='aemo'
    GROUP BY 1
  ) s
  GROUP BY 1
)${transmissionCte}

SELECT
  EXTRACT(EPOCH FROM time AT TIME ZONE $4)*1000 AS time,
  ${transmissionSelect} AS transmission,
  g.value AS gen,
  l.value AS load,
  g.value+${transmissionSelect}-l.value AS diff,
  add_max_terra(g.value+${transmissionSelect}-l.value) OVER (ORDER BY time) AS sum_deficit,
  SUM(GREATEST(0, g.value+${transmissionSelect}-l.value)) OVER (ORDER BY time) AS cum_surplus,
  SUM(LEAST(0, g.value+${transmissionSelect}-l.value)) OVER (ORDER BY time) AS cum_deficit,
  SUM(LEAST(g.value+${transmissionSelect},l.value)) OVER (ORDER BY time) AS cum_matched
FROM _generation g
INNER JOIN _load l USING(time)${transmissionJoin}
ORDER BY time`;
  const args = [
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ];
  const summary = await chartQuery<AnyRow>(req, summarySql, [
    ...args,
    mult.nuclear,
    mult.wind,
    mult.solar,
    pt,
    mult.demand,
  ]);
  const options = await simulationOptions(req, args, mult, pt, summary, includeTransmission, ctx.interval * 1000);
  return sendChartResponse(
    req,
    reply,
    options,
    ctx.timezoneAbbreviation,
    { production_types: await getProductionTypeOptions(ctx.areaIds) },
    900,
  );
}

async function simulationOptions(
  req: FastifyRequest,
  args: unknown[],
  mult: { nuclear: number; wind: number; solar: number; demand: number },
  productionTypeIds: number[],
  summaryRows: AnyRow[],
  includeTransmission: boolean,
  intervalMs = 3600000,
) {
  const summary = summaryRows.at(-1) ?? {};

  const startTime = summaryRows.find((r: AnyRow) => r.time != null)?.time as number | undefined;
  const interval = intervalMs;

  const options: any = {
    height: 900,
    tooltip: { trigger: "axis", formatter: { type: "multi" } },
    title: [],
    legend: [],
    grid: [],
    xAxis: [],
    yAxis: [],
    series: [],
    startTime,
    interval,
  };

  await addGenerationPanel(options, req, args, mult, productionTypeIds, includeTransmission);
  addSummaryPanel(options, summary);
  addCumulativeDeficitPanel(options, summaryRows);
  addDifferencePanel(options, summaryRows);

  return options;
}

const genSql = `
SELECT
  EXTRACT(EPOCH FROM time AT TIME ZONE $4)*1000 AS time,
  name2 AS metric,
  SUM(value) AS value
FROM (
  SELECT
    time_bucket_gapfill('1h'::interval,time) AS time,
    pt.name,
    pt.name2,
    INTERPOLATE(CASE WHEN pt.name='nuclear' THEN AVG(g.value)*$5 WHEN pt.name LIKE 'wind%' THEN AVG(g.value)*$6 WHEN pt.name LIKE 'solar%' THEN AVG(g.value)*$7 ELSE AVG(g.value) END) AS value
  FROM generation_data g
  INNER JOIN areas_production_types apt ON(g.areas_production_type_id=apt.id)
  INNER JOIN production_types pt ON(apt.production_type_id=pt.id)
  WHERE
    time BETWEEN $1 AND $2 AND
    apt.area_id=ANY($3::int[]) AND
    apt.production_type_id=ANY($8::int[])
  GROUP BY 1,pt.name,pt.name2
) s
GROUP BY 1,name2
ORDER BY 2,1
`;
const demandSql = `
SELECT
  EXTRACT(EPOCH FROM time AT TIME ZONE $4)*1000 AS time,
  'demand' AS metric,
  SUM(value)*$5 AS value
FROM (
  SELECT
    time_bucket_gapfill('1h'::interval,time) AS time,
    INTERPOLATE(AVG(l.value)) AS value
  FROM load l
  WHERE
    time BETWEEN $1 AND $2 AND
    area_id=ANY($3::int[])
  GROUP BY 1

  UNION

  SELECT
    time_bucket_gapfill('1h'::interval,time) AS time,
    INTERPOLATE(AVG(g.value)) AS value
  FROM generation_data g
  INNER JOIN areas_production_types apt ON(g.areas_production_type_id=apt.id)
  INNER JOIN production_types pt ON(apt.production_type_id=pt.id)
  INNER JOIN areas a ON(apt.area_id=a.id)
  WHERE
    time BETWEEN $1 AND $2 AND
    apt.area_id=ANY($3::int[]) AND
    pt.name='solar_rooftop' AND
    a.source='aemo'
  GROUP BY 1
) s
GROUP BY 1
ORDER BY 1
`;
const transSql = `
SELECT
  EXTRACT(EPOCH FROM time AT TIME ZONE $4)*1000 AS time,
  'transmission' AS metric,
  SUM(value) AS value
FROM (
  (
    SELECT
      time_bucket_gapfill('1h'::interval,time) AS time,
      from_area_id,
      to_area_id,
      INTERPOLATE(AVG(t.value)) AS value
    FROM transmission_data t
    INNER JOIN areas_areas aa ON(t.areas_area_id=aa.id)
    WHERE
      aa.from_area_id=ANY($3::int[]) AND
      NOT (aa.to_area_id=ANY($3::int[])) AND
      time BETWEEN $1 AND $2
    GROUP BY 1,2,3
  ) UNION (
    SELECT
      time_bucket_gapfill('1h'::interval,time) AS time,
      to_area_id AS from_area_id,
      from_area_id AS to_area_id,
      INTERPOLATE(-AVG(t.value)) AS value
    FROM transmission_data t
    INNER JOIN areas_areas aa ON(t.areas_area_id=aa.id)
    WHERE
      aa.to_area_id=ANY($3::int[]) AND
      NOT (aa.from_area_id=ANY($3::int[])) AND
      time BETWEEN $1 AND $2
    GROUP BY 1,2,3
  )
) s
INNER JOIN areas from_area ON(from_area_id=from_area.id)
INNER JOIN areas to_area ON(to_area_id=to_area.id)
WHERE
  (from_area.type <> 'country' OR to_area.type='country')
GROUP BY 1
ORDER BY 1
`;
async function addGenerationPanel(
  options: any,
  req: FastifyRequest,
  args: unknown[],
  mult: { nuclear: number; wind: number; solar: number; demand: number },
  productionTypeIds: number[],
  includeTransmission: boolean,
) {
  const genRows = await chartQuery<AnyRow>(req, genSql, [
    ...args,
    mult.nuclear,
    mult.wind,
    mult.solar,
    productionTypeIds,
  ]);
  const demandRows = await chartQuery<AnyRow>(req, demandSql, [...args, mult.demand]);
  const transRows = includeTransmission ? await chartQuery<AnyRow>(req, transSql, args) : [];
  const colorFn = colorsFromQuery((req.query as Record<string, string | undefined>).colors);

  const genSeries = divergentSeries(buildStackedPowerLineSeries(genRows)).map((s) => ({
    ...s,
    itemStyle: { color: colorFn(s.name) },
  }));
  const demandSeries = buildStackedPowerLineSeries(demandRows).map((s) => ({
    ...s,
    name: "demand",
    stack: undefined,
    areaStyle: undefined,
    lineStyle: { width: 2 },
    itemStyle: { color: "rgb(36, 41, 46)" },
  }));
  const transSeries = includeTransmission ? divergentSeries(buildStackedPowerLineSeries(transRows)).map((s) => ({
    ...s,
    name: "transmission",
    itemStyle: { color: colorFn("transmission") },
  })) : [];
  const gridIndex = options.grid.length;
  const series = [
    ...transSeries,
    ...genSeries,
    ...demandSeries,
  ].map((s) => ({ ...s, xAxisIndex: gridIndex, yAxisIndex: gridIndex }));

  options.title.push({ text: "Generation", left: "center", right: "15%", top: 10 });
  options.legend.push({
    top: 30,
    left: "center",
    right: "15%",
    data: [...new Set(series.map((s) => s.name))],
  });
  options.grid.push({ left: "3%", right: "15%", top: "7%", height: "25%" });
  options.xAxis.push({ type: "category", gridIndex, axisLabel: { show: false } });
  options.yAxis.push(powerAxis(gridIndex));
  options.series.push(...series);
}

function addSummaryPanel(options: any, data: AnyRow) {
  const gridIndex = options.grid.length;

  options.title.push({ text: "Summary", left: "93.5%", top: 10, textAlign: "center" });
  options.grid.push({ left: "89%", right: "2%", top: "7%", height: "55%" });
  options.xAxis.push({ type: "category", gridIndex, data: [""] });
  options.yAxis.push(energyAxis(gridIndex));
  options.series.push(
    summaryBarSeries("Matched", "rgb(86, 166, 75)", gridIndex, Number(data.cum_matched || 0)),
    summaryBarSeries("Surplus", "rgb(242, 204, 12)", gridIndex, Number(data.cum_surplus || 0)),
    summaryBarSeries("Deficit", "rgb(224, 47, 68)", gridIndex, Number(data.cum_deficit || 0)),
  );
}

function addCumulativeDeficitPanel(options: any, rows: AnyRow[]) {
  const gridIndex = options.grid.length;

  options.title.push({ text: "Cumulative Deficit", left: "center", right: "15%", top: "33%" });
  options.legend.push({ top: "35%", left: "center", right: "15%", data: ["sum deficit"] });
  options.grid.push({ left: "3%", right: "15%", top: "37%", height: "25%" });
  options.xAxis.push({ type: "category", gridIndex, axisLabel: { show: false } });
  options.yAxis.push(energyAxis(gridIndex));
  options.series.push(lineSeries("sum deficit", "energy", gridIndex, fieldData(rows, "sum_deficit")));
}

function summaryBarSeries(name: string, color: string, axisIndex: number, value: number) {
  const formattedValue = formatEnergy(value);
  return {
    name,
    type: "bar",
    unit: "energy",
    xAxisIndex: axisIndex,
    yAxisIndex: axisIndex,
    stack: "summary",
    itemStyle: { color },
    label: {
      show: true,
      position: "inside",
      formatter: `${name}\n${formattedValue}`,
      color: "#111827",
      fontSize: 18,
      lineHeight: 26,
    },
    data: [value],
  };
}

function addDifferencePanel(options: any, rows: AnyRow[]) {
  const gridIndex = options.grid.length;

  options.title.push({ text: "Difference", left: "center", top: "65%" });
  options.legend.push({
    top: "67%",
    left: "center",
    data: [
      "transmission",
      "generation",
      "load",
      "diff",
      "cum matched",
      "cum surplus",
      "cum deficit",
    ],
  });
  options.grid.push({ left: "3%", right: "2%", top: "69%", height: "26%" });
  options.xAxis.push({ type: "category", gridIndex, axisLabel: { formatter: { type: "date" } } });
  options.yAxis.push(powerAxis(gridIndex));
  options.series.push(
    lineSeries("transmission", "power", gridIndex, fieldData(rows, "transmission")),
    lineSeries("generation", "power", gridIndex, fieldData(rows, "gen")),
    lineSeries("load", "power", gridIndex, fieldData(rows, "load")),
    lineSeries("diff", "power", gridIndex, fieldData(rows, "diff")),
    lineSeries("cum matched", "energy", gridIndex, fieldData(rows, "cum_matched")),
    lineSeries("cum surplus", "energy", gridIndex, fieldData(rows, "cum_surplus")),
    lineSeries("cum deficit", "energy", gridIndex, fieldData(rows, "cum_deficit")),
  );
}

function powerAxis(gridIndex: number) {
  return {
    type: "value",
    gridIndex,
    axisLabel: { formatter: { type: "power" } },
  };
}

function energyAxis(gridIndex: number) {
  return {
    type: "value",
    gridIndex,
    axisLabel: { formatter: { type: "energy" } },
  };
}

function fieldData(rows: AnyRow[], field: string) {
  return rows.map((row) => Number(row[field] || 0));
}

function lineSeries(name: string, unit: string, axisIndex: number, data: any[]) {
  return {
    name,
    type: "line",
    unit,
    xAxisIndex: axisIndex,
    yAxisIndex: axisIndex,
    symbol: "none",
    data,
  };
}
