import type { FastifyReply, FastifyRequest } from "fastify";
import { chartQuery } from "./shared/chartQuery.ts";
import { getContext } from "./shared/context.ts";
import { sendUplotResponse } from "./shared/chartResponse.ts";
import { buildStackedPowerLineSeries } from "./shared/series.ts";
import {
  getProductionTypeIds,
  getProductionTypeOptions,
} from "./shared/productionTypes.ts";
import { colorsFromQuery } from "./shared/colors.ts";
import type { AnyRow, DashboardParams, DashboardQuery } from "./shared/types.ts";
import type { UplotSeriesDesc } from "./shared/uplotOptions.ts";

/** A panel descriptor sent to the frontend. */
type PanelDesc = {
  title: string;
  mainSeries: UplotSeriesDesc[];
  extraSeries?: UplotSeriesDesc[];
  axisScale?: string;
  barCenter?: boolean;
};


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
      INTERPOLATE(CASE WHEN pt.name='nuclear' THEN AVG(g.value)*$4 WHEN pt.name LIKE 'wind%' THEN AVG(g.value)*$5 WHEN pt.name LIKE 'solar%' THEN AVG(g.value)*$6 ELSE AVG(g.value) END) AS value
    FROM generation_data g
    INNER JOIN areas_production_types apt ON(g.areas_production_type_id=apt.id)
    INNER JOIN production_types pt ON(apt.production_type_id=pt.id)
    WHERE
      time BETWEEN $1 AND $2 AND
      apt.area_id=ANY($3::int[]) AND
      apt.production_type_id=ANY($7::int[])
    GROUP BY 1,pt.name,apt.area_id
  ) s
  GROUP BY 1
),

_load AS (
  SELECT
    time,
    'load' AS metric,
    SUM(value)*$8 AS value
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
  EXTRACT(EPOCH FROM time ) AS time,
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
  ];
  const summary = await chartQuery<AnyRow>(req, summarySql, [
    ...args,
    mult.nuclear,
    mult.wind,
    mult.solar,
    pt,
    mult.demand,
  ]);

  // Compute startTime from the first row of gen data (primary time-series source)
  const genRows = await chartQuery<AnyRow>(req, genSql, [...args, mult.nuclear, mult.wind, mult.solar, pt]);
  const startTimeRaw = genRows[0]?.time as number | undefined;
  const startTime = startTimeRaw != null && startTimeRaw > 1e8 ? startTimeRaw : undefined;
  const interval = 3600; // SQL buckets at 1-hour intervals

  // Build panel payloads
  const genPanel = await buildGenPanelFromRows(genRows, req, args, mult, pt, includeTransmission);
  const summaryData = summary.at(-1) ?? {};
  const summaryPanel = buildSummaryPanel(summaryData);
  const cumPanel = buildCumulativePanel(summary);
  const diffPanel = buildDifferencePanel(summary);

  const productionTypes = await getProductionTypeOptions(ctx.areaIds);

  return sendUplotResponse(req, reply, {
    panels: [
      { ...genPanel, layout: { gridRow: "1", gridColumn: "1" } },
      { ...summaryPanel, layout: { gridRow: "1 / 3", gridColumn: "2" } },
      { ...cumPanel, layout: { gridRow: "2", gridColumn: "1" } },
      { ...diffPanel, layout: { gridRow: "3", gridColumn: "1 / 3" } },
    ],
    startTime,
    interval,
    timezone: ctx.timezone,
    layout: { columns: "1fr 160px", rows: "225px 225px 225px" },
    height: 900,
  }, { production_types: productionTypes });
}

const genSql = `
SELECT
  EXTRACT(EPOCH FROM time ) AS time,
  name2 AS metric,
  SUM(value) AS value
FROM (
  SELECT
    time_bucket_gapfill('1h'::interval,time) AS time,
    pt.name,
    pt.name2,
    INTERPOLATE(CASE WHEN pt.name='nuclear' THEN AVG(g.value)*$4 WHEN pt.name LIKE 'wind%' THEN AVG(g.value)*$5 WHEN pt.name LIKE 'solar%' THEN AVG(g.value)*$6 ELSE AVG(g.value) END) AS value
  FROM generation_data g
  INNER JOIN areas_production_types apt ON(g.areas_production_type_id=apt.id)
  INNER JOIN production_types pt ON(apt.production_type_id=pt.id)
  WHERE
    time BETWEEN $1 AND $2 AND
    apt.area_id=ANY($3::int[]) AND
    apt.production_type_id=ANY($7::int[])
  GROUP BY 1,pt.name,pt.name2
) s
GROUP BY 1,name2
ORDER BY 2,1
`;
const demandSql = `
SELECT
  EXTRACT(EPOCH FROM time ) AS time,
  'demand' AS metric,
  SUM(value)*$4 AS value
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
  EXTRACT(EPOCH FROM time ) AS time,
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
async function buildGenPanelFromRows(
  genRows: AnyRow[],
  req: FastifyRequest,
  args: unknown[],
  mult: { nuclear: number; wind: number; solar: number; demand: number },
  productionTypeIds: number[],
  includeTransmission: boolean,
): Promise<PanelDesc> {
  const demandRows = await chartQuery<AnyRow>(req, demandSql, [...args, mult.demand]);
  const transRows = includeTransmission ? await chartQuery<AnyRow>(req, transSql, args) : [];
  const colorFn = colorsFromQuery((req.query as Record<string, string | undefined>).colors);

  function applyColor(s: AnyRow, label: string): UplotSeriesDesc {
    const c = colorFn(label);
    return { label, data: s.data as number[], stroke: c, fill: c ? c.replace("rgb(", "rgba(").replace(")", ",0.75)") : undefined };
  }

  const genSeries: UplotSeriesDesc[] = buildStackedPowerLineSeries(genRows).map((s: AnyRow) => applyColor(s, s.label));
  const demandSeries: UplotSeriesDesc[] = buildStackedPowerLineSeries(demandRows).map((s: AnyRow) => ({
    label: "demand",
    data: s.data as number[],
    stack: undefined,
    stroke: "rgb(36, 41, 46)",
    width: 2,
    fill: undefined,
  }));
  const transSeries: UplotSeriesDesc[] = includeTransmission
    ? buildStackedPowerLineSeries(transRows).map((s: AnyRow) => applyColor(s, "transmission"))
    : [];

  const mainSeries = [...transSeries, ...genSeries, ...demandSeries];

  return { title: "Generation", mainSeries };
}

function buildSummaryPanel(data: AnyRow): PanelDesc {
  const pos = (name: string, color: string, value: number): UplotSeriesDesc => ({
    label: name,
    data: [value],
    stroke: color,
    fill: color,
    width: 0,
    type: "bar",
    stack: "pos",
  });
  const neg = (name: string, color: string, value: number): UplotSeriesDesc => ({
    label: name,
    data: [value],
    stroke: color,
    fill: color,
    width: 0,
    type: "bar",
    stack: "neg",
  });

  return {
    title: "Summary",
    mainSeries: [
      pos("Matched", "rgb(86, 166, 75)", Number(data.cum_matched || 0)),
      pos("Surplus", "rgb(242, 204, 12)", Number(data.cum_surplus || 0)),
      neg("Deficit", "rgb(224, 47, 68)", Number(data.cum_deficit || 0)),
    ],
    axisScale: "energy",
    barCenter: true,
  };
}

function buildCumulativePanel(rows: AnyRow[]): PanelDesc {
  return {
    title: "Cumulative Deficit",
    mainSeries: [{
      label: "sum deficit",
      data: rows.map((r) => Number(r.sum_deficit || 0)),
      stroke: "rgb(224, 47, 68)",
      width: 2,
    }],
    axisScale: "energy",
  };
}

function buildDifferencePanel(rows: AnyRow[]): PanelDesc {
  const fieldData = (field: string) => rows.map((r) => Number(r[field] || 0));
  return {
    title: "Difference",
    mainSeries: [
      { label: "transmission", data: fieldData("transmission"), stroke: "rgb(124, 46, 163)", width: 1.5 },
      { label: "generation", data: fieldData("gen"), stroke: "rgb(0, 119, 255)", width: 1.5 },
      { label: "load", data: fieldData("load"), stroke: "rgb(36, 41, 46)", width: 1.5 },
      { label: "diff", data: fieldData("diff"), stroke: "rgb(255, 165, 0)", width: 1.5 },
      { label: "cum matched", data: fieldData("cum_matched"), stroke: "rgb(86, 166, 75)", width: 1.5 },
      { label: "cum surplus", data: fieldData("cum_surplus"), stroke: "rgb(242, 204, 12)", width: 1.5 },
      { label: "cum deficit", data: fieldData("cum_deficit"), stroke: "rgb(224, 47, 68)", width: 1.5 },
    ],
  };
}
