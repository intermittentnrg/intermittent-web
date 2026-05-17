import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "../lib/db.js";
import { chartQuery } from "./shared/chartQuery.js";
import { calculateInterval } from "./shared/intervals.js";
import { getAreaContext } from "./shared/context.js";
import {
  buildChartOptions,
  buildDualAxisOptions,
} from "./shared/chartOptions.js";
import { sendChartResponse } from "./shared/chartResponse.js";
import { buildStackedPowerLineSeries } from "./shared/series.js";
import { getProductionTypeIds } from "./shared/productionTypes.js";
import type { AnyRow, DashboardParams, DashboardQuery } from "./shared/types.js";

const mapSql = `WITH _gen AS (SELECT time_bucket_gapfill('1h',time) AS time, area_id, production_type_id, INTERPOLATE(AVG(value)) AS value FROM generation g INNER JOIN areas a ON(area_id=a.id) WHERE area_id=ANY($1::int[]) AND electricitymaps_id IS NOT NULL AND production_type_id=ANY($2::int[]) AND time BETWEEN $3 AND $4 GROUP BY 1,2,3), _gen_sum AS (SELECT time,area_id,SUM(value) AS value FROM _gen GROUP BY 1,2), _peak AS (SELECT area_id,production_type_id,MAX(value) AS value FROM generation g INNER JOIN areas a ON(area_id=a.id) WHERE area_id=ANY($1::int[]) AND electricitymaps_id IS NOT NULL AND production_type_id=ANY($2::int[]) AND time BETWEEN ($3::timestamptz - '1 year'::interval) AND $4::timestamptz GROUP BY 1,2), _peak_sum AS (SELECT area_id,SUM(value) AS value FROM _peak GROUP BY 1) SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5)*1000 AS time, a.electricitymaps_id AS metric, g.value/NULLIF(peak.value,0) AS value FROM _gen_sum g INNER JOIN _peak_sum peak ON(g.area_id=peak.area_id) INNER JOIN areas a ON(g.area_id=a.id) WHERE time BETWEEN $3 AND $4 ORDER BY 1`;
export async function maps(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getAreaContext(req.params);
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
function buildFrames(rows: AnyRow[], timezone = "UTC") {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
  const map = new Map<number, any>();
  for (const r of rows) {
    const t = Number(r.time);
    if (!map.has(t))
      map.set(t, {
        data: [{ locations: [], z: [] }],
        layout: { title: formatter.format(new Date(t)) },
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
      time_bucket_gapfill('15m', time) AS bucket,
      a.electricitymaps_id AS metric,
      LOCF(AVG(value)/100) AS value,
      area_id
    FROM prices p
    INNER JOIN areas a ON(p.area_id=a.id)
    WHERE
      region = 'europe' AND
      electricitymaps_id IS NOT NULL AND
      time BETWEEN $1 AND $2
    GROUP BY bucket, metric, area_id
  ) s
  ORDER BY 1,2
`;

export async function priceMap(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getAreaContext({
    ...req.params,
    region: "europe",
    area_type: "region",
    area: "europe",
  });
  const rows = await chartQuery<AnyRow>(req, priceMapSql, [
    ctx.from,
    ctx.to,
    ctx.timezone,
  ]);
  const frames = buildFrames(rows, ctx.timezone);
  return sendChartResponse(
    req,
    reply,
    priceMapOptions(frames),
    ctx.timezoneAbbreviation,
    {
      frames,
      geoJsonUrl: "/assets/world-rewound.geojson",
      mapName: "world",
    },
    800,
  );
}

function priceMapOptions(frames: any[]) {
  const build = (f: any) =>
    (f?.data?.[0]?.locations || []).map((loc: string, i: number) => ({
      name: loc,
      value: f.data[0].z[i],
    }));
  return {
    baseOption: {
      timeline: {
        axisType: "category",
        autoPlay: false,
        playInterval: 500,
        data: frames.map((f, i) => ({ value: i, text: f.layout.title })),
        left: "10%",
        right: "10%",
        bottom: 20,
      },
      title: {
        text: frames[0]?.layout?.title || "Price map",
        left: "center",
        top: 24,
        textStyle: { fontSize: 54, fontWeight: 700 },
      },
      tooltip: { trigger: "item", formatter: "{b}: {c} €/MWh" },
      visualMap: {
        type: "continuous",
        min: 0,
        max: 500,
        left: 24,
        top: 180,
        itemHeight: 960,
        itemWidth: 34,
        text: ["", ""],
        calculable: true,
        realtime: false,
        inRange: {
          color: [
            "#0077FF",
            "#00E676",
            "#FFFF00",
            "#FFAA00",
            "#FF3300",
            "#CC0000",
            "#331111",
            "#000000",
          ],
        },
      },
      graphic: [0, 100, 200, 300, 400, 500].map((value) => ({
        type: "text",
        left: 82,
        top: 180 + ((500 - value) / 500) * 960 - 14,
        silent: true,
        style: {
          text: `${value}€/MWh`,
          fill: "#222222",
          font: "600 24px Inter, Helvetica, Arial, sans-serif",
        },
      })),
      series: [
        {
          name: "Price",
          type: "map",
          map: "world",
          roam: true,
          nameProperty: "zoneName",
          center: [7, 52],
          zoom: 7.5,
          itemStyle: {
            borderColor: "#333333",
            borderWidth: 1.4,
            areaColor: "#d9d9d9",
          },
          emphasis: {
            itemStyle: {
              borderColor: "#111111",
              borderWidth: 2,
            },
          },
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

export async function sweden(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getAreaContext({
    ...req.params,
    region: "europe",
    area_type: "region",
    area: "SE1,SE2,SE3,SE4",
  });
  const interval = calculateInterval(
    ctx.from,
    ctx.to,
    req.query.width,
    req.query.min_interval,
  );
  const sql = `SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5)*1000 AS time, metric, SUM(value) AS value FROM (SELECT time_bucket_gapfill($1::interval,time) AS time, a.code||'/load' AS metric, INTERPOLATE(AVG(l.value)) AS value FROM load l INNER JOIN areas a ON(l.area_id=a.id) WHERE time BETWEEN $2 AND $3 AND area_id=ANY($4::int[]) GROUP BY 1,2 UNION SELECT time_bucket_gapfill($1::interval,time) AS time, a.code||'/'||pt.name AS metric, INTERPOLATE(AVG(g.value)) AS value FROM generation g INNER JOIN areas a ON(g.area_id=a.id) INNER JOIN production_types pt ON(g.production_type_id=pt.id) WHERE time BETWEEN $2 AND $3 AND area_id=ANY($4::int[]) GROUP BY 1,2) s GROUP BY 1,metric ORDER BY 2,1`;
  const rows = await chartQuery<AnyRow>(req, sql, [
    `${interval} seconds`,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ]);
  return sendChartResponse(
    req,
    reply,
    buildChartOptions(buildStackedPowerLineSeries(rows), "Sweden", "power"),
    ctx.timezoneAbbreviation,
    {},
    768,
  );
}
