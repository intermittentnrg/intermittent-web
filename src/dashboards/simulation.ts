import type { FastifyReply, FastifyRequest } from "fastify";
import { chartQuery } from "./shared/chartQuery.js";
import { getContext } from "./shared/context.js";
import {
  buildChartOptions,
  buildDualAxisOptions,
} from "./shared/chartOptions.js";
import { sendChartResponse } from "./shared/chartResponse.js";
import { buildStackedPowerLineSeries } from "./shared/series.js";
import {
  getProductionTypeIds,
  getProductionTypeOptions,
} from "./shared/productionTypes.js";
import type { AnyRow, DashboardParams, DashboardQuery } from "./shared/types.js";


export async function simulations(
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
  const genSql = `SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5)*1000 AS time, CASE WHEN SUM(value)<0 THEN name2||'_negative' ELSE name2 END AS metric, SUM(value) AS value FROM (SELECT time_bucket_gapfill($1::interval,time) AS time, pt.name, pt.name2, INTERPOLATE(CASE WHEN pt.name='nuclear' THEN AVG(g.value)*$6 WHEN pt.name LIKE 'wind%' THEN AVG(g.value)*$7 WHEN pt.name LIKE 'solar%' THEN AVG(g.value)*$8 ELSE AVG(g.value) END) AS value FROM generation_data g INNER JOIN areas_production_types apt ON(g.areas_production_type_id=apt.id) INNER JOIN production_types pt ON(apt.production_type_id=pt.id) WHERE time BETWEEN $2 AND $3 AND apt.area_id=ANY($4::int[]) AND apt.production_type_id=ANY($9::int[]) GROUP BY 1,pt.name,pt.name2) s GROUP BY 1,name2 ORDER BY 2,1`;
  const demandSql = `SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5)*1000 AS time, 'demand' AS metric, SUM(value)*$6 AS value FROM (SELECT time_bucket_gapfill($1::interval,time) AS time, INTERPOLATE(AVG(l.value)) AS value FROM load l WHERE time BETWEEN $2 AND $3 AND area_id=ANY($4::int[]) GROUP BY 1 UNION SELECT time_bucket_gapfill($1::interval,time) AS time, INTERPOLATE(AVG(g.value)) AS value FROM generation_data g INNER JOIN areas_production_types apt ON(g.areas_production_type_id=apt.id) INNER JOIN production_types pt ON(apt.production_type_id=pt.id) INNER JOIN areas a ON(apt.area_id=a.id) WHERE time BETWEEN $2 AND $3 AND apt.area_id=ANY($4::int[]) AND pt.name='solar_rooftop' AND a.source='aemo' GROUP BY 1) s GROUP BY 1 ORDER BY 1`;
  const transSql = `SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5)*1000 AS time, CASE WHEN SUM(value)<0 THEN 'export' ELSE 'import' END AS metric, SUM(value) AS value FROM ((SELECT time_bucket_gapfill($1::interval,time) AS time, from_area_id, to_area_id, INTERPOLATE(AVG(t.value)) AS value FROM transmission_data t INNER JOIN areas_areas aa ON(t.areas_area_id=aa.id) WHERE aa.from_area_id=ANY($4::int[]) AND NOT (aa.to_area_id=ANY($4::int[])) AND time BETWEEN $2 AND $3 GROUP BY 1,2,3) UNION (SELECT time_bucket_gapfill($1::interval,time) AS time, to_area_id AS from_area_id, from_area_id AS to_area_id, INTERPOLATE(-AVG(t.value)) AS value FROM transmission_data t INNER JOIN areas_areas aa ON(t.areas_area_id=aa.id) WHERE aa.to_area_id=ANY($4::int[]) AND NOT (aa.from_area_id=ANY($4::int[])) AND time BETWEEN $2 AND $3 GROUP BY 1,2,3)) s INNER JOIN areas from_area ON(from_area_id=from_area.id) INNER JOIN areas to_area ON(to_area_id=to_area.id) WHERE (from_area.type <> 'country' OR to_area.type='country') GROUP BY 1 ORDER BY 1`;
  const args = [
    `${ctx.interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ];
  const gen = await chartQuery<AnyRow>(req, genSql, [
    ...args,
    mult.nuclear,
    mult.wind,
    mult.solar,
    pt,
  ]);
  const demand = await chartQuery<AnyRow>(req, demandSql, [...args, mult.demand]);
  const trans = await chartQuery<AnyRow>(req, transSql, args);
  const options = simulationOptions(gen, demand, trans);
  return sendChartResponse(
    req,
    reply,
    options,
    ctx.timezoneAbbreviation,
    { production_types: await getProductionTypeOptions(ctx.areaIds) },
    900,
  );
}

function simulationOptions(
  genRows: AnyRow[],
  demandRows: AnyRow[],
  transRows: AnyRow[],
) {
  const genSeries = buildStackedPowerLineSeries(genRows).map((s) => ({
    ...s,
    xAxisIndex: 0,
    yAxisIndex: 0,
  }));
  const demandSeries = buildStackedPowerLineSeries(demandRows).map((s) => ({
    ...s,
    name: "demand",
    stack: undefined,
    areaStyle: undefined,
    lineStyle: { width: 2 },
    itemStyle: { color: "rgb(36, 41, 46)" },
    xAxisIndex: 0,
    yAxisIndex: 0,
  }));
  const transSeries = buildStackedPowerLineSeries(transRows).map((s) => ({
    ...s,
    xAxisIndex: 0,
    yAxisIndex: 0,
    itemStyle: { color: "rgb(163, 82, 204)" },
  }));
  const byTime = new Map<
    number,
    { gen: number; load: number; trans: number }
  >();
  for (const r of genRows) {
    const t = Number(r.time);
    const o = byTime.get(t) || { gen: 0, load: 0, trans: 0 };
    o.gen += Number(r.value || 0);
    byTime.set(t, o);
  }
  for (const r of demandRows) {
    const t = Number(r.time);
    const o = byTime.get(t) || { gen: 0, load: 0, trans: 0 };
    o.load += Number(r.value || 0);
    byTime.set(t, o);
  }
  for (const r of transRows) {
    const t = Number(r.time);
    const o = byTime.get(t) || { gen: 0, load: 0, trans: 0 };
    o.trans += Number(r.value || 0);
    byTime.set(t, o);
  }
  let cumSurplus = 0,
    cumDeficit = 0,
    cumMatched = 0,
    sumDeficit = 0;
  const diff: any[] = [],
    genLine: any[] = [],
    loadLine: any[] = [],
    transLine: any[] = [],
    sumDefData: any[] = [],
    matched: any[] = [],
    surplus: any[] = [],
    deficit: any[] = [];
  for (const [t, o] of [...byTime.entries()].sort((a, b) => a[0] - b[0])) {
    const d = o.gen + o.trans - o.load;
    cumSurplus += Math.max(0, d);
    cumDeficit += Math.min(0, d);
    cumMatched += Math.min(o.gen + o.trans, o.load);
    sumDeficit = Math.min(0, sumDeficit + d);
    genLine.push([t, o.gen * 1000]);
    loadLine.push([t, o.load * 1000]);
    transLine.push([t, o.trans * 1000]);
    diff.push([t, d * 1000]);
    sumDefData.push([t, sumDeficit * 1000]);
    matched.push([t, cumMatched * 1000]);
    surplus.push([t, cumSurplus * 1000]);
    deficit.push([t, cumDeficit * 1000]);
  }
  return {
    height: 900,
    title: [
      { text: "Generation", left: "center", right: "15%", top: 10 },
      { text: "Summary", left: "93.5%", top: 10, textAlign: "center" },
      { text: "Cumulative Deficit", left: "center", right: "15%", top: "36%" },
      { text: "Difference", left: "center", top: "65%" },
    ],
    tooltip: { trigger: "axis", formatter: { type: "multi" } },
    legend: [
      {
        top: 30,
        left: "center",
        right: "15%",
        data: [
          ...new Set(
            [...genSeries, ...demandSeries, ...transSeries].map((s) => s.name),
          ),
        ],
      },
      { top: "60%", left: "93%", data: ["Surplus", "Matched", "Deficit"] },
      { top: "38%", left: "center", right: "15%", data: ["sum deficit"] },
      {
        top: "67%",
        left: "center",
        data: [
          "transmission",
          "generation",
          "load",
          "diff",
          "sum deficit",
          "cum matched",
          "cum surplus",
          "cum deficit",
        ],
      },
    ],
    grid: [
      { left: "3%", right: "15%", top: "10%", height: "25%" },
      { left: "89%", right: "2%", top: "10%", height: "48%" },
      { left: "3%", right: "15%", top: "40%", height: "25%" },
      { left: "3%", right: "2%", top: "69%", height: "26%" },
    ],
    xAxis: [
      { type: "time", gridIndex: 0, axisLabel: { show: false } },
      { type: "category", gridIndex: 1, data: [""] },
      { type: "time", gridIndex: 2, axisLabel: { show: false } },
      { type: "time", gridIndex: 3 },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        axisLabel: { formatter: { type: "power" } },
      },
      {
        type: "value",
        gridIndex: 1,
        axisLabel: { formatter: { type: "energy" } },
      },
      {
        type: "value",
        gridIndex: 2,
        axisLabel: { formatter: { type: "energy" } },
      },
      {
        type: "value",
        gridIndex: 3,
        axisLabel: { formatter: { type: "power" } },
      },
    ],
    series: [
      ...transSeries,
      ...genSeries,
      ...demandSeries,
      {
        name: "Matched",
        type: "bar",
        unit: "energy",
        xAxisIndex: 1,
        yAxisIndex: 1,
        stack: "total",
        itemStyle: { color: "rgb(86, 166, 75)" },
        data: [cumMatched * 1000],
      },
      {
        name: "Surplus",
        type: "bar",
        unit: "energy",
        xAxisIndex: 1,
        yAxisIndex: 1,
        stack: "total",
        itemStyle: { color: "rgb(242, 204, 12)" },
        data: [cumSurplus * 1000],
      },
      {
        name: "Deficit",
        type: "bar",
        unit: "energy",
        xAxisIndex: 1,
        yAxisIndex: 1,
        stack: "total",
        itemStyle: { color: "rgb(224, 47, 68)" },
        data: [cumDeficit * 1000],
      },
      {
        name: "sum deficit",
        type: "line",
        unit: "energy",
        xAxisIndex: 2,
        yAxisIndex: 2,
        symbol: "none",
        data: sumDefData,
      },
      {
        name: "transmission",
        type: "line",
        unit: "power",
        xAxisIndex: 3,
        yAxisIndex: 3,
        symbol: "none",
        data: transLine,
      },
      {
        name: "generation",
        type: "line",
        unit: "power",
        xAxisIndex: 3,
        yAxisIndex: 3,
        symbol: "none",
        data: genLine,
      },
      {
        name: "load",
        type: "line",
        unit: "power",
        xAxisIndex: 3,
        yAxisIndex: 3,
        symbol: "none",
        data: loadLine,
      },
      {
        name: "diff",
        type: "line",
        unit: "power",
        xAxisIndex: 3,
        yAxisIndex: 3,
        symbol: "none",
        data: diff,
      },
      {
        name: "cum matched",
        type: "line",
        unit: "energy",
        xAxisIndex: 3,
        yAxisIndex: 3,
        symbol: "none",
        data: matched,
      },
      {
        name: "cum surplus",
        type: "line",
        unit: "energy",
        xAxisIndex: 3,
        yAxisIndex: 3,
        symbol: "none",
        data: surplus,
      },
      {
        name: "cum deficit",
        type: "line",
        unit: "energy",
        xAxisIndex: 3,
        yAxisIndex: 3,
        symbol: "none",
        data: deficit,
      },
    ],
  };
}
