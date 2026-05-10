import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "./lib/db.js";

export type DashboardParams = { region: string; area_type: string; area: string; date_range: string };
type Params = DashboardParams;
type Query = { width?: string; min_interval?: string; prices?: string };

type AreaContext = {
  areaIds: number[];
  from: Date;
  to: Date;
  timezone: string;
  timezoneAbbreviation: string;
};

type DataRow = {
  time: string | number | null;
  metric?: string | null;
  value?: string | number | null;
  import?: string | number | null;
  export?: string | number | null;
};

const SQL_GEN = `
  WITH _g AS (
    SELECT
      time_bucket_gapfill($1::interval, time) AS time,
      production_type_group_id,
      INTERPOLATE(AVG(value)) AS value
    FROM generation_data g
    INNER JOIN areas_production_types apt ON(areas_production_type_id=apt.id)
    INNER JOIN production_types pt ON(production_type_id=pt.id)
    WHERE time BETWEEN $2 AND $3 AND area_id = ANY($4::int[])
    GROUP BY 1,2,areas_production_type_id
  )
  SELECT
    EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time,
    CASE WHEN SUM(value)<0 THEN ptg.name||'_negative' ELSE ptg.name END AS metric,
    SUM(value) AS value
  FROM _g
  INNER JOIN production_type_groups ptg ON(production_type_group_id=ptg.id)
  WHERE value IS NOT NULL
  GROUP BY ptg.name, 1
  ORDER BY 2, 1
`;

const SQL_GEN_HOURLY = `
  WITH _g AS (
    SELECT time, production_type_group_id, SUM(value) AS value
    FROM generation_data_hourly g
    INNER JOIN areas_production_types apt ON(areas_production_type_id=apt.id)
    INNER JOIN production_types pt ON(production_type_id=pt.id)
    WHERE time BETWEEN $2 AND $3 AND area_id = ANY($4::int[])
    GROUP BY 1,2
  )
  SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, metric, value
  FROM (
    SELECT
      time_bucket_gapfill($1::interval, time) AS time,
      CASE WHEN SUM(value)<0 THEN ptg.name||'_negative' ELSE ptg.name END AS metric,
      INTERPOLATE(AVG(value)) AS value
    FROM _g
    INNER JOIN production_type_groups ptg ON(production_type_group_id=ptg.id)
    WHERE time BETWEEN $2 AND $3
    GROUP BY ptg.name, 1
    ORDER BY 2, 1
  ) s
`;

const SQL_TRANS = `
  WITH _transmission AS (
    SELECT time_bucket_gapfill($1::interval, time) AS time, areas_area_id, INTERPOLATE(AVG(value)) AS value
    FROM transmission_data t
    WHERE areas_area_id IN(
      SELECT aa.id FROM areas_areas aa
      INNER JOIN areas fa ON(from_area_id=fa.id)
      INNER JOIN areas ta ON(to_area_id=ta.id)
      WHERE from_area_id = ANY($4::int[]) AND NOT (to_area_id = ANY($4::int[])) AND (fa.type <> 'country' OR ta.type = 'country')
    ) AND time BETWEEN $2 AND $3
    GROUP BY 1,2
  UNION
    SELECT time_bucket_gapfill($1::interval, time) AS time, areas_area_id, INTERPOLATE(-AVG(value)) AS value
    FROM transmission_data t
    WHERE areas_area_id IN(
      SELECT aa.id FROM areas_areas aa
      INNER JOIN areas fa ON(from_area_id=fa.id)
      INNER JOIN areas ta ON(to_area_id=ta.id)
      WHERE to_area_id = ANY($4::int[]) AND NOT (from_area_id = ANY($4::int[])) AND (ta.type <> 'country' OR fa.type = 'country')
    ) AND time BETWEEN $2 AND $3
    GROUP BY 1,2
  ), _transmission_avg AS (
    SELECT time,from_area_id,to_area_id,AVG(value) AS value
    FROM _transmission t
    INNER JOIN areas_areas aa ON(areas_area_id=aa.id)
    GROUP BY 1,2,3
  )
  SELECT
    EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time,
    GREATEST(0,SUM(value)) AS import,
    LEAST(0,SUM(value)) AS export,
    SUM(value) AS value
  FROM _transmission_avg
  INNER JOIN areas from_area ON(from_area_id=from_area.id)
  INNER JOIN areas to_area ON(to_area_id=to_area.id)
  GROUP BY 1
  ORDER BY 1
`;

export async function electricityMix(request: FastifyRequest<{ Params: Params; Querystring: Query }>, reply: FastifyReply) {
  const ctx = await getAreaContext(request.params);
  if (ctx.areaIds.length === 0) return reply.code(400).send({ error: "No valid areas found" });

  const interval = calculateInterval(ctx.from, ctx.to, request.query.width, request.query.min_interval);
  const intervalSql = `${interval} seconds`;
  const args = [intervalSql, ctx.from, ctx.to, ctx.areaIds, ctx.timezone];

  const transData = await querySmall<DataRow>(SQL_TRANS, args);
  const evenHourOffset = true; // Good enough for initial port; Rails uses TZInfo current offset.
  const genSql = interval >= 3600 && evenHourOffset ? SQL_GEN_HOURLY : SQL_GEN;
  const genData = await querySmall<DataRow>(genSql, args);

  const series = buildSeriesFromData([...transData, ...genData]);

  return reply.header("Cache-Control", "public, max-age=3600").send({
    options: buildDualAxisOptions(series, "Electricity Mix"),
    height: 567,
    timezone: ctx.timezoneAbbreviation,
  });
}

export async function getAreaContext(params: Params): Promise<AreaContext> {
  const [fromRaw, toRaw] = params.date_range.split("_to_").map((part) => part?.replaceAll("_", " "));
  const from = parseAppDate(fromRaw, false);
  const to = parseAppDate(toRaw, true);

  const areaCodes = params.area.split(",").map((code) => code.trim()).filter(Boolean);
  const allAreas = areaCodes.length === 0 || areaCodes.includes("all");
  const areaRows = allAreas
    ? await querySmall<{ id: number }>("SELECT id FROM areas WHERE region=$1 AND type=$2 AND enabled='t'", [params.region, params.area_type])
    : await querySmall<{ id: number }>("SELECT id FROM areas WHERE code = ANY($1::text[]) AND region=$2 AND type=$3 AND enabled='t'", [areaCodes, params.region, params.area_type]);
  const areaIds = areaRows.map((row) => row.id);

  const [tz] = await querySmall<{ timezone: string }>("SELECT timezone FROM areas WHERE id = ANY($1::int[]) ORDER BY timezone_priority LIMIT 1", [areaIds]);
  const timezone = tz?.timezone || "UTC";

  return { areaIds, from, to, timezone, timezoneAbbreviation: timezoneAbbr(timezone) };
}

function parseAppDate(value: string | undefined, end: boolean) {
  const now = new Date();
  if (!value || value === "now") return now;
  const match = value.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const d = new Date(now);
    const multipliers: Record<string, number> = { minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3 };
    if (unit in multipliers) return new Date(now.getTime() - amount * multipliers[unit]);
    if (unit === "month") d.setMonth(d.getMonth() - amount);
    if (unit === "year") d.setFullYear(d.getFullYear() - amount);
    return d;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    if (end) parsed.setHours(23, 59, 59, 999);
    return parsed;
  }
  throw new Error(`Could not parse date_range value: ${value}`);
}

function parseIntervalString(str = "15m") {
  const table: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "6h": 21600, "12h": 43200, "1d": 86400, "1w": 604800, "1M": 2592000 };
  return table[str] || 900;
}

export function calculateInterval(from: Date, to: Date, widthValue?: string, minIntervalValue?: string) {
  const minInterval = parseIntervalString(minIntervalValue || "15m");
  const width = Math.max(Number(widthValue || 1000), 1);
  const targetInterval = Math.floor((to.getTime() - from.getTime()) / 1000 / width);
  if (targetInterval <= minInterval) return minInterval;
  return [900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 172800, 604800, 2592000].filter((i) => i <= targetInterval).at(-1) || minInterval;
}

function buildSeriesFromData(data: DataRow[]) {
  const timestamps = [...new Set(data.map((row) => Number(row.time)).filter((time) => Number.isFinite(time)))].sort((a, b) => a - b);
  const seriesMap = new Map<string, ReturnType<typeof newSeries>>();

  for (const row of data) {
    const timestamp = Number(row.time);
    if (!Number.isFinite(timestamp)) continue;

    for (const [key, raw] of [["import", row.import], ["export", row.export]] as const) {
      if (raw !== undefined && raw !== null) {
        if (!seriesMap.has(key)) seriesMap.set(key, newSeries(key));
        seriesMap.get(key)!.data.push([timestamp, Number(raw) * 1000]);
      }
    }

    if (row.metric) {
      const key = row.metric;
      if (!seriesMap.has(key)) seriesMap.set(key, newSeries(key));
      seriesMap.get(key)!.data.push([timestamp, row.value == null ? null : Number(row.value) * 1000]);
    }
  }

  for (const series of seriesMap.values()) {
    const existing = new Set(series.data.map((point) => point[0]));
    for (const ts of timestamps) if (!existing.has(ts)) series.data.push([ts, null]);
    series.data.sort((a, b) => a[0] - b[0]);
  }

  return [...seriesMap.values()];
}

function newSeries(key: string) {
  return {
    name: key,
    type: "line",
    unit: "power",
    stack: key === "export" ? "export" : "total",
    symbol: "none",
    areaStyle: { opacity: 0.75 },
    lineStyle: { width: 0 },
    itemStyle: { color: getColorForMetric(key) },
    data: [] as Array<[number, number | null]>,
  };
}

function getColorForMetric(metric: string) {
  return ({
    "01_biomass_and_waste": "rgb(128, 224, 167)",
    "02_nuclear": "rgb(213, 0, 50)",
    "03_lignite": "rgb(92, 26, 35)",
    "04_hard_coal": "rgb(137, 137, 137)",
    "05_gas": "rgb(198, 163, 201)",
    "06_hydro": "rgb(2, 77, 188)",
    "07_other": "rgb(241, 194, 27)",
    "08_other_renewable": "rgb(199, 156, 148)",
    "09_wind": "rgb(152, 205, 251)",
    "09_wind_onshore": "rgb(152, 205, 251)",
    "11_solar": "rgb(236, 232, 26)",
    import: "rgb(124, 46, 163)",
    export: "rgb(124, 46, 163)",
  } as Record<string, string>)[metric];
}

export function buildDualAxisOptions(series: Array<{ name: string; yAxisIndex?: number }>, title: string) {
  return {
    useUTC: true,
    title: { text: title, left: "center", top: 10 },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" }, formatter: { type: "multi" } },
    legend: { type: "scroll", orient: "horizontal", top: 40, data: [...new Set(series.map((s) => s.name))] },
    grid: { left: "3%", right: "4%", bottom: "3%", top: "18%", containLabel: true },
    xAxis: { type: "time", boundaryGap: false },
    yAxis: [{ type: "value", axisLabel: { formatter: { type: "power" } } }],
    series,
  };
}

function timezoneAbbr(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date());
  return parts.find((part) => part.type === "timeZoneName")?.value || timeZone;
}
