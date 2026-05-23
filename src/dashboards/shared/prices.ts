import type { FastifyRequest } from "fastify";
import { chartQuery } from "./chartQuery.ts";
import type { Series, TimeMetricValueRow } from "./types.ts";

type PriceSeriesOptions = {
  yAxisIndex?: number;
  colorForMetric?: (metric: string) => string | undefined;
};

const priceSql = `
  SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, metric, value
  FROM (
    SELECT
      time_bucket_gapfill($1::interval, time) AS time,
      a.code AS metric,
      LOCF(AVG(p.value)/100) AS value
    FROM prices p
    INNER JOIN areas a ON(p.area_id=a.id)
    WHERE
      (
        area_id = ANY($4::int[]) OR
        area_id IN(SELECT child_id FROM area_associations WHERE parent_id = ANY($4::int[])) OR
        area_id IN(SELECT parent_id FROM area_associations WHERE child_id = ANY($4::int[]))
      ) AND
      time BETWEEN $2 AND $3
    GROUP BY 1,2
    ORDER BY 2,1
  ) s
`;

export async function getPriceSeries(
  request: FastifyRequest,
  args: [string, Date, Date, number[], string],
  options: PriceSeriesOptions = {},
) {
  const rows = await chartQuery<TimeMetricValueRow>(request, priceSql, args);
  const series: Series[] = [];
  let currentSeries: Series | undefined;

  for (const row of rows) {
    const key = String(row.metric);
    if (currentSeries?.name !== key) {
      currentSeries = newPriceSeries(key, options);
      series.push(currentSeries);
    }
    currentSeries.data!.push([row.time, row.value]);
  }

  return series;
}

function newPriceSeries(key: string, options: PriceSeriesOptions = {}): Series {
  const color = options.colorForMetric?.(key) || getColorForPrice(key);
  return {
    name: key,
    type: "line",
    unit: "price",
    symbol: "none",
    step: "start",
    lineStyle: { width: 2, color },
    itemStyle: { color },
    yAxisIndex: options.yAxisIndex,
    data: [] as Array<[number, number]>,
  };
}

function getColorForPrice(metric: string) {
  const greens = [
    "rgb(0, 100, 0)",
    "rgb(0, 128, 0)",
    "rgb(34, 139, 34)",
    "rgb(46, 139, 87)",
    "rgb(60, 179, 113)",
    "rgb(85, 107, 47)",
    "rgb(107, 142, 35)",
    "rgb(128, 128, 0)",
    "rgb(85, 128, 0)",
    "rgb(50, 120, 50)",
  ];
  let hash = 0;
  for (let i = 0; i < metric.length; i++)
    hash = (Math.imul(31, hash) + metric.charCodeAt(i)) | 0;
  return greens[Math.abs(hash) % greens.length];
}
