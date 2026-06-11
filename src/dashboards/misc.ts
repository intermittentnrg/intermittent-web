import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "../lib/db.ts";
import { chartQuery } from "./shared/chartQuery.ts";
import { getContext } from "./shared/context.ts";
import { sendChartResponse, sendUplotResponse } from "./shared/chartResponse.ts";
import { resolutionToSeconds } from "../shared/dateParsing.ts";
import { parseDateRangeInTimeZone } from "./shared/timezoneDateRange.ts";
import { getProductionTypeIds } from "./shared/productionTypes.ts";
import type { AnyRow, DashboardParams, DashboardQuery } from "./shared/types.ts";
import type { UplotSeriesDesc } from "./shared/uplotOptions.ts";
import { colorsFromQuery } from "./shared/colors.ts";
import { buildMapTimelineFrames, buildMapTimelineOptions } from "./shared/mapTimeline.ts";
import { titleize } from "./shared/text.ts";

/** Convert an rgb() color to rgba() with given opacity. */
function rgba(color: string | undefined, opacity: number): string | undefined {
  if (!color) return undefined;
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `,${opacity})`);
  return color;
}

/**
 * Helper: accumulate data into per-area series arrays, building UplotSeriesDesc directly.
 * `series` carries a _areaIdx property for later panel splitting.
 */
// Internal type for series that carry their area index
interface SeriesWithArea extends UplotSeriesDesc { _areaIdx: number; _key?: string; }

function pushSeries(
  key: string,
  make: () => SeriesWithArea,
  row: AnyRow,
  pushValue: number,
  target: SeriesWithArea[]
) {
  const last = target[target.length - 1];
  if (last && last._key === key) {
    last.data.push(pushValue);
  } else {
    const s = make();
    s.data = [pushValue];
    s._key = key;
    target.push(s);
  }
}

const mapSql = `WITH _gen AS (SELECT time_bucket_gapfill('1h',time) AS time, area_id, production_type_id, INTERPOLATE(AVG(value)) AS value FROM generation g INNER JOIN areas a ON(area_id=a.id) WHERE area_id=ANY($1::int[]) AND electricitymaps_id IS NOT NULL AND production_type_id=ANY($2::int[]) AND time BETWEEN $3 AND $4 GROUP BY 1,2,3), _gen_sum AS (SELECT time,area_id,SUM(value) AS value FROM _gen GROUP BY 1,2), _peak AS (SELECT area_id,production_type_id,MAX(value) AS value FROM generation g INNER JOIN areas a ON(area_id=a.id) WHERE area_id=ANY($1::int[]) AND electricitymaps_id IS NOT NULL AND production_type_id=ANY($2::int[]) AND time BETWEEN ($3::timestamptz - '1 year'::interval) AND $4::timestamptz GROUP BY 1,2), _peak_sum AS (SELECT area_id,SUM(value) AS value FROM _peak GROUP BY 1) SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5)*1000 AS time, a.electricitymaps_id AS metric, g.value/NULLIF(peak.value,0) AS value FROM _gen_sum g INNER JOIN _peak_sum peak ON(g.area_id=peak.area_id) INNER JOIN areas a ON(g.area_id=a.id) WHERE time BETWEEN $3 AND $4 ORDER BY 1`;
export async function maps(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const pt = await getProductionTypeIds(
    ctx.areaIds,
    req.query.production_type || "nuclear",
  );
  const areas = (
    await querySmall<{ id: number }>(
      `SELECT id FROM areas WHERE region::text=ANY($1::text[]) AND enabled='t' AND code <> ALL($2::text[])`,
      [
        [
          "europe",
          "mexico",
          "brazil",
          "canada",
          "south_africa",
          "usa",
          "india",
        ],
        ["BR-N", "BR-NE", "BR-S", "NEVP"],
      ],
    )
  ).map((r) => r.id);
  const rows = await chartQuery<AnyRow>(req, mapSql, [
    areas,
    pt,
    ctx.from,
    ctx.to,
    ctx.timezone,
  ]);
  const frames = buildFrames(rows);
  return sendChartResponse(
    req,
    reply,
    mapOptions(frames),
    ctx.timezoneAbbreviation,
    {
      frames,
      geoJsonUrl: "/assets/world-rewound.geojson",
    },
    800,
  );
}
function buildFrames(rows: AnyRow[], timeZoneLabel = "UTC") {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const map = new Map<number, any>();
  for (const r of rows) {
    const t = Number(r.time);
    if (!map.has(t))
      map.set(t, {
        data: [{ locations: [], z: [] }],
        layout: { title: `${formatter.format(new Date(t))} ${timeZoneLabel}` },
        name: String(t),
      });
    map.get(t).data[0].locations.push(r.metric);
    map.get(t).data[0].z.push(Number(r.value));
  }
  return [...map.values()];
}
function mapOptions(frames: any[]) {
  const build = (f: any) =>
    (f?.data?.[0]?.locations || []).map((loc: string, i: number) => ({
      name: loc,
      value: f.data[0].z[i],
    }));
  return {
    baseOption: {
      timeline: {
        axisType: "category",
        autoPlay: true,
        playInterval: 500,
        data: frames.map((f, i) => ({ value: i, text: f.layout.title })),
        left: "10%",
        right: "10%",
        bottom: 20,
      },
      title: { text: "", left: "center", top: 10 },
      tooltip: { trigger: "item", formatter: "{b}: ({c}%)" },
      visualMap: {
        min: 0,
        max: 1,
        left: "left",
        top: "bottom",
        text: ["High", "Low"],
        calculable: true,
      },
      series: [
        {
          name: "Value",
          type: "map",
          map: "world",
          roam: true,
          nameProperty: "zoneName",
          data: build(frames[0]),
        },
      ],
      animation: false,
    },
    options: frames.map((f) => ({
      title: { text: f.layout.title },
      series: [{ data: build(f) }],
    })),
  };
}

const priceMapSql = `
  SELECT
    EXTRACT(EPOCH FROM bucket AT TIME ZONE $3)*1000 AS time,
    metric,
    value
  FROM (
    SELECT
      time_bucket_gapfill($4::interval, time) AS bucket,
      a.electricitymaps_id AS metric,
      LOCF(AVG(value)/100) AS value,
      area_id
    FROM prices p
    INNER JOIN areas a ON(p.area_id=a.id)
    WHERE
      time BETWEEN $1 AND $2 AND
      electricitymaps_id IS NOT NULL AND
      (
        area_id=ANY($5::int[]) OR
        area_id IN(SELECT child_id FROM area_associations WHERE parent_id=ANY($5::int[]))
      )
    GROUP BY bucket, metric, area_id
  ) s
  ORDER BY 1,2
`;

const generationOfPeakMapSql = `
  WITH _gen AS (
    SELECT
      time_bucket_gapfill($4::interval, time) AS time,
      area_id,
      production_type_id,
      INTERPOLATE(AVG(value)) AS value
    FROM generation g
    WHERE
      area_id=ANY($5::int[]) AND
      production_type_id=ANY($6::int[]) AND
      time BETWEEN $1 AND $2
    GROUP BY 1,2,3
  ),
  _gen_sum AS (
    SELECT
      time,
      area_id,
      SUM(value) AS value
    FROM _gen
    GROUP BY 1,2
  ),
  _peak AS (
    SELECT
      area_id,
      production_type_id,
      MAX(value) AS value
    FROM generation g
    WHERE
      area_id=ANY($5::int[]) AND
      production_type_id=ANY($6::int[]) AND
      time BETWEEN ($2::timestamptz - '1 year'::interval) AND $2::timestamptz
    GROUP BY 1,2
  ),
  _peak_sum AS (
    SELECT
      area_id,
      SUM(value) AS value
    FROM _peak
    GROUP BY 1
  )
  SELECT
    EXTRACT(EPOCH FROM g.time AT TIME ZONE $3)*1000 AS time,
    a.electricitymaps_id AS metric,
    (g.value/NULLIF(peak.value,0))*100 AS value
  FROM _gen_sum g
  INNER JOIN _peak_sum peak ON(g.area_id=peak.area_id)
  INNER JOIN areas a ON(g.area_id=a.id)
  WHERE
    a.electricitymaps_id IS NOT NULL AND
    g.time BETWEEN $1 AND $2
  ORDER BY 1,2
`;

export async function priceMap(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getMapContext(req);
  const rows = await chartQuery<AnyRow>(req, priceMapSql, [
    ctx.from,
    ctx.to,
    ctx.timezone,
    `${ctx.interval} seconds`,
    ctx.areaIds,
  ]);
  const frames = buildMapTimelineFrames(rows, timezoneAbbr(ctx.timezone, ctx.from));
  const currencySymbol = req.params.region === "australia" ? "$" : "€";
  return sendChartResponse(
    req,
    reply,
    buildMapTimelineOptions(frames, {
      title: "Price map",
      valueName: "Price",
      tooltip: `{b}: {c} ${currencySymbol}/MWh`,
      visualMap: {
        type: "continuous",
        min: 0,
        max: 500,
        left: 24,
        top: 50,
        bottom: 60,
        itemHeight: 700,
        itemWidth: 34,
        text: ["", ""],
        calculable: true,
        realtime: false,
        inRange: {
          color: ["#0077FF", "#00E676", "#FFFF00", "#FFAA00", "#FF3300", "#CC0000", "#331111", "#000000"],
        },
      },
      graphics: [0, 100, 200, 300, 400, 500].map((value) => ({
        type: "text",
        left: 82,
        top: 50 + ((500 - value) / 500) * 690,
        $value: value,
        silent: true,
        style: {
          text: `{value|${currencySymbol}${value}}\n{unit|/MWh}`,
          fill: "#222222",
          rich: {
            value: { font: "600 24px Inter, Helvetica, Arial, sans-serif", lineHeight: 28 },
            unit: { font: "600 24px Inter, Helvetica, Arial, sans-serif", lineHeight: 28, padding: [4, 0, 0, 0] },
          },
        },
      })),
      map: { center: [7, 52], zoom: 7.5 },
      label: {
        show: true,
        color: "#111111",
        fontFamily: "Inter, Helvetica, Arial, sans-serif",
        fontSize: 18,
        fontWeight: "bold",
        textBorderColor: "#ffffff",
        textBorderWidth: 4,
        formatter: { type: "blank-invalid-template", template: `{c} ${currencySymbol}/MWh` },
      },
    }),
    ctx.timezoneAbbreviation,
    {
      frames,
      geoJsonUrl: "/assets/world-rewound.geojson",
      mapName: "world",
    },
    800,
  );
}

export async function generationOfPeakMap(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getMapContext(req);
  const productionTypeIds = await getProductionTypeIds(ctx.areaIds, req.query.production_type || "nuclear");
  const productionTypeTitle = titleize(req.query.production_type || "nuclear");
  const rows = await chartQuery<AnyRow>(req, generationOfPeakMapSql, [
    ctx.from,
    ctx.to,
    ctx.timezone,
    `${ctx.interval} seconds`,
    ctx.areaIds,
    productionTypeIds,
  ]);
  const frames = buildMapTimelineFrames(rows, timezoneAbbr(ctx.timezone, ctx.from));
  const optTitle = `${productionTypeTitle} generation % of peak`;
  return sendChartResponse(
    req,
    reply,
    buildMapTimelineOptions(frames, {
      title: optTitle,
      valueName: optTitle,
      tooltip: "{b}: {c}%",
      visualMap: {
        type: "continuous",
        min: 0,
        max: 100,
        left: 24,
        top: 180,
        itemHeight: 960,
        itemWidth: 34,
        text: ["", ""],
        calculable: true,
        realtime: false,
        inRange: { color: ["#000000", "#330000", "#660000", "#990000", "#cc0000", "#ff3300", "#ff9900", "#ffff00"] },
      },
      graphics: [0, 25, 50, 75, 100].map((value) => ({
        type: "text",
        left: 82,
        top: 180 + ((100 - value) / 100) * 960 - 14,
        silent: true,
        style: {
          text: `{value|${value}%}`,
          fill: "#222222",
          rich: {
            value: { font: "600 24px Inter, Helvetica, Arial, sans-serif", lineHeight: 28 },
          },
        },
      })),
      map: { center: [7, 52], zoom: 1.4 },
    }),
    ctx.timezoneAbbreviation,
    {
      frames,
      geoJsonUrl: "/assets/world-rewound.geojson",
      mapName: "world",
    },
    800,
  );
}

async function getMapContext(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
) {
  const [fromRaw, toRaw] = req.params.date_range
    .split("_to_")
    .map((part) => part?.replaceAll("_", " "));
  const areaCodes = req.params.area
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  let areaRows: { id: number }[];

  if (req.params.region === "all" && req.params.area_type === "all") {
    areaRows = await querySmall<{ id: number }>(
      "SELECT id FROM areas WHERE enabled='t' AND electricitymaps_id IS NOT NULL",
      [],
    );
  } else if (areaCodes.length === 0 || areaCodes.includes("all")) {
    areaRows = await querySmall<{ id: number }>(`
      SELECT id FROM areas
      WHERE
        region=$1 AND
        type=$2 AND
        enabled='t'
      `,
      [req.params.region, req.params.area_type],
    );
  } else {
    areaRows = await querySmall<{ id: number }>(`
      SELECT id FROM areas
      WHERE
        region=$1 AND
        type=$2 AND
        code = ANY($3::text[]) AND
        enabled='t'
      `,
      [req.params.region, req.params.area_type, areaCodes],
    );
  }
  const areaIds = areaRows.map((row) => row.id);
  const [tz] = await querySmall<{ timezone: string }>(
    "SELECT timezone FROM areas WHERE id = ANY($1::int[]) ORDER BY timezone_priority LIMIT 1",
    [areaIds],
  );
  const timezone = req.params.region === "all" ? "UTC" : tz?.timezone || "UTC";
  const { from, to } = parseDateRangeInTimeZone(fromRaw, toRaw, timezone);

  return {
    areaIds,
    from,
    to,
    timezone,
    timezoneAbbreviation: timezoneAbbr(timezone, from),
    interval: resolutionToSeconds(req.query.resolution, "15m"),
  };
}

function timezoneAbbr(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((part) => part.type === "timeZoneName")?.value || timeZone;
}


const swedenGenSql = `
SELECT
  EXTRACT(EPOCH FROM time AT TIME ZONE $5) AS time,
  metric,
  SUM(value) AS value
FROM (
  SELECT time_bucket_gapfill($1::interval,time) AS time, a.code||'/load' AS metric, INTERPOLATE(AVG(l.value)) AS value
  FROM load l
  INNER JOIN areas a ON(l.area_id=a.id)
  WHERE
    time BETWEEN $2 AND $3 AND
    area_id=ANY($4::int[])
  GROUP BY 1,2
UNION
  SELECT time_bucket_gapfill($1::interval,time) AS time, a.code||'/'||pt.name AS metric, INTERPOLATE(AVG(g.value)) AS value
  FROM generation g
  INNER JOIN areas a ON(g.area_id=a.id)
  INNER JOIN production_types pt ON(g.production_type_id=pt.id)
  WHERE
    time BETWEEN $2 AND $3 AND
    area_id=ANY($4::int[])
  GROUP BY 1,2
) s
GROUP BY 1,metric
ORDER BY 2,1
`;

const swedenTransSql = `
  WITH _transmission AS (
    SELECT
      time_bucket_gapfill($1::interval, time) AS time,
      from_area_id,
      to_area_id,
      INTERPOLATE(AVG(value)) AS value
    FROM transmission_data t
    INNER JOIN areas_areas aa ON(areas_area_id=aa.id)
    WHERE
      from_area_id = ANY($2::int[]) AND
      time BETWEEN $3 AND $4
    GROUP BY 1,2,3
  UNION
    SELECT
      time_bucket_gapfill($1::interval, time) AS time,
      to_area_id AS from_area_id,
      from_area_id AS to_area_id,
      INTERPOLATE(-AVG(value)) AS value
    FROM transmission_data t
    INNER JOIN areas_areas aa ON(areas_area_id=aa.id)
    WHERE
      to_area_id = ANY($2::int[]) AND
      time BETWEEN $3 AND $4
    GROUP BY 1,2,3
  ), _transmission_avg AS (
    SELECT time, from_area_id, to_area_id, AVG(value) AS value
    FROM _transmission
    GROUP BY 1,2,3
  )
  SELECT
    EXTRACT(EPOCH FROM time AT TIME ZONE $5) AS time,
    code AS area_code,
    SUM(CASE WHEN to_area_id = ANY($2::int[]) THEN value ELSE 0 END) AS transmission_domestic,
    SUM(CASE WHEN NOT (to_area_id = ANY($2::int[])) THEN value ELSE 0 END) AS transmission_international
  FROM _transmission_avg
  INNER JOIN areas a ON (from_area_id = a.id)
  GROUP BY 1, 2
  ORDER BY 2, 1
`;

const swedenPriceSql = `
  SELECT
    EXTRACT(EPOCH FROM time AT TIME ZONE $5) AS time,
    metric,
    value
  FROM (
    SELECT
      time_bucket_gapfill($1::interval, time) AS time,
      a.code AS metric,
      LOCF(AVG(p.value)/100) AS value
    FROM prices p
    INNER JOIN areas a ON(p.area_id=a.id)
    WHERE
      area_id=ANY($2::int[]) AND
      time BETWEEN $3 AND $4
    GROUP BY 1,2
    ORDER BY 2,1
  ) s
`;

export async function sweden(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req, {
    region: "europe",
    area_type: "zone",
    area: "SE1,SE2,SE3,SE4",
  });

  const colorFn = colorsFromQuery(req.query.colors);

  const genRows = await chartQuery<AnyRow>(req, swedenGenSql, [
    `${ctx.interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ]);

  const showTrans = req.query.transmission !== "0";
  const transRows = showTrans
    ? await chartQuery<AnyRow>(req, swedenTransSql, [
        `${ctx.interval} seconds`,
        ctx.areaIds,
        ctx.from,
        ctx.to,
        ctx.timezone,
      ])
    : [];

  const showPrice = req.query.prices === "true" || req.query.prices === "1";
  const showLoad = req.query.load === "true" || req.query.load === "1";
  const priceRows = showPrice
    ? await chartQuery<AnyRow>(req, swedenPriceSql, [
        `${ctx.interval} seconds`,
        ctx.areaIds,
        ctx.from,
        ctx.to,
        ctx.timezone,
      ])
    : [];

  const areaCodes = ["SE1", "SE2", "SE3", "SE4"];
  const numAreas = areaCodes.length;

  // ── Build UplotSeriesDesc arrays per area ──
  // Transmission + generation (stacked) and load go to mainSeries.
  // Price goes to extraSeries (secondary axis).

  const stackedSeries: SeriesWithArea[] = [];
  const loadSeries: SeriesWithArea[] = [];
  const priceSeries: SeriesWithArea[] = [];

  // Transmission: domestic
  for (const row of transRows) {
    const areaIdx = areaCodes.indexOf(row.area_code as string);
    if (areaIdx === -1) continue;
    const v = row.transmission_domestic as number;
    if (v == null) continue;
    pushSeries(`dom_${areaIdx}`, () => ({
      label: "domestic", data: [], _areaIdx: areaIdx,
      stroke: "rgb(210, 180, 230)", fill: "rgba(210, 180, 230, 0.75)", width: 0,
    }), row, v, stackedSeries);
  }

  // Transmission: international
  for (const row of transRows) {
    const areaIdx = areaCodes.indexOf(row.area_code as string);
    if (areaIdx === -1) continue;
    const v = row.transmission_international as number;
    if (v == null) continue;
    pushSeries(`int_${areaIdx}`, () => ({
      label: "international", data: [], _areaIdx: areaIdx,
      stroke: "rgb(124, 46, 163)", fill: "rgba(124, 46, 163, 0.75)", width: 0,
    }), row, v, stackedSeries);
  }

  // Generation and load
  for (const row of genRows) {
    const metric = String(row.metric);
    const slashIdx = metric.indexOf("/");
    if (slashIdx === -1) continue;
    const areaIdx = areaCodes.indexOf(metric.substring(0, slashIdx));
    const type = metric.substring(slashIdx + 1);
    if (areaIdx === -1) continue;

    if (type === "load") {
      if (!showLoad) continue;
      pushSeries(`load_${areaIdx}`, () => ({
        label: "load", data: [], _areaIdx: areaIdx,
        stroke: "#000", width: 2,
      }), row, row.value as number, loadSeries);
    } else {
      const c = colorFn(type);
      pushSeries(`gen_${areaIdx}_${type}`, () => ({
        label: type, data: [], _areaIdx: areaIdx,
        stroke: c, fill: rgba(c, 0.75), width: 0,
      }), row, row.value as number, stackedSeries);
    }
  }

  // Price
  for (const row of priceRows) {
    const areaIdx = areaCodes.indexOf(String(row.metric));
    if (areaIdx === -1) continue;
    pushSeries(`price_${areaIdx}`, () => ({
      label: "Price", data: [], _areaIdx: areaIdx,
      stroke: "green", width: 2, scale: "price-r",
    }), row, row.value as number, priceSeries);
  }

  // Split by area into per-panel main/extra series
  const allSeries = [...stackedSeries, ...loadSeries, ...priceSeries];

  const panelSeries: { areaCode: string; mainSeries: UplotSeriesDesc[]; extraSeries: UplotSeriesDesc[] }[] = [];
  for (let i = 0; i < numAreas; i++) {
    const main: UplotSeriesDesc[] = [];
    const extra: UplotSeriesDesc[] = [];
    for (const s of allSeries) {
      if (s._areaIdx !== i) continue;
      const uS: UplotSeriesDesc = { label: s.label, data: s.data, stroke: s.stroke, width: s.width, fill: s.fill };
      if (s.stack) uS.stack = `${s.stack}_${i}`;
      if (s.scale === "price-r") { extra.push(uS); } else { main.push(uS); }
    }
    panelSeries.push({ areaCode: areaCodes[i], mainSeries: main, extraSeries: extra });
  }

  // Build shared legend from unique labels across all panels
  const legendGroups: { label: string; color: string; visible: boolean }[] = [];
  const seen = new Set<string>();
  for (const ps of panelSeries) {
    for (const s of [...ps.mainSeries, ...ps.extraSeries]) {
      if (!seen.has(s.label)) {
        seen.add(s.label);
        legendGroups.push({ label: s.label, color: s.stroke || "#888", visible: true });
      }
    }
  }

  const startTime = genRows[0]?.time as number | undefined;
  const interval = ctx.interval;
  const currencySymbol = req.params.region === "australia" ? "$" : "€";

  return sendUplotResponse(req, reply, {
    panels: panelSeries.map((ps, i) => ({
      mainSeries: ps.mainSeries,
      extraSeries: ps.extraSeries,
      layout: { gridRow: `${i + 1}`, gridColumn: "1" },
      // Hide x-axis on all panels except the last (bottom) one
      xAxisSize: i < numAreas - 1 ? 0 : undefined,
      // Remove default canvas padding so panels stack tightly
      padding: [0, 0, 0, 0],
      currencySymbol,
    })),
    sharedLegend: { groups: legendGroups },
    startTime,
    interval,
    timezone: ctx.timezone,
    layout: { columns: "1fr", rows: `repeat(${numAreas}, 1fr)` },
    height: 900,
  });
}
