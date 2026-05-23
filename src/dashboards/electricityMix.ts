import type { FastifyReply, FastifyRequest } from "fastify";
import { chartQuery } from "./shared/chartQuery.ts";
import { getContext } from "./shared/context.ts";
import { buildDualAxisOptions } from "./shared/chartOptions.ts";
import { sendChartResponse } from "./shared/chartResponse.ts";
import { getPriceSeries } from "./shared/prices.ts";
import type { DashboardParams, DashboardQuery, TimeMetricValueRow } from "./shared/types.ts";
import { divergentSeries } from "./shared/series.ts";
import { metricColor } from "./shared/colors.ts";

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
    ptg.name AS metric,
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
      ptg.name AS metric,
      INTERPOLATE(AVG(value)) AS value
    FROM _g
    INNER JOIN production_type_groups ptg ON(production_type_group_id=ptg.id)
    WHERE time BETWEEN $2 AND $3
    GROUP BY ptg.name, 1
    ORDER BY 2, 1
  ) s
`;

type TransmissionRow = {
  time: number;
  import: number;
  export: number;
  value: number;
};

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

export async function electricityMix(
  request: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(request);
  if (ctx.areaIds.length === 0)
    return reply.code(400).send({ error: "No valid areas found" });

  const intervalSql = `${ctx.interval} seconds`;
  const args: [string, Date, Date, number[], string] = [
    intervalSql,
    ctx.from,
    ctx.to,
    ctx.areaIds,
    ctx.timezone,
  ];

  const transData = await chartQuery<TransmissionRow>(request, SQL_TRANS, args);
  const evenHourOffset = true; // Good enough for initial port; Rails uses TZInfo current offset.
  const genSql = ctx.interval >= 3600 && evenHourOffset ? SQL_GEN_HOURLY : SQL_GEN;
  const genData = await chartQuery<TimeMetricValueRow>(request, genSql, args);

  const series = divergentSeries(buildSeriesFromData([
    ...transmissionRowsToSeriesRows(transData),
    ...genData,
  ]));

  if (request.query.prices)
    (series as Array<ReturnType<typeof newSeries> | Awaited<ReturnType<typeof getPriceSeries>>[number]>).push(
      ...(await getPriceSeries(request, args, { yAxisIndex: 1 })),
    );

  return sendChartResponse(
    request,
    reply,
    buildDualAxisOptions(series, "Electricity Mix"),
    ctx.timezoneAbbreviation,
  );
}

function transmissionRowsToSeriesRows(rows: TransmissionRow[]): TimeMetricValueRow[] {
  const output: TimeMetricValueRow[] = [];

  for (const row of rows) {
    output.push({ time: row.time, metric: "import", value: row.import });
    output.push({ time: row.time, metric: "export", value: row.export });
  }

  return output;
}

function buildSeriesFromData(data: TimeMetricValueRow[]) {
  const seriesMap = new Map<string, ReturnType<typeof newSeries>>();

  for (const row of data) {
    const key = row.metric;
    if (!seriesMap.has(key)) seriesMap.set(key, newSeries(key));
    seriesMap.get(key)!.data.push([row.time, row.value * 1000]);
  }

  for (const series of seriesMap.values()) {
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
    itemStyle: { color: metricColor(key) },
    data: [] as Array<[number, number]>,
  };
}
