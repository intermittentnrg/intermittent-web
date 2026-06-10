import type { FastifyRequest } from "fastify";
import { chartQuery } from "./chartQuery.ts";
import type { TimeMetricValueRow } from "./types.ts";
import type { UplotSeriesDesc } from "./uplotOptions.ts";

type PriceSeriesOptions = {
  /** Scale key: "%" for secondary axis (prices), defaults to primary "y". */
  scale?: string;
  colorForMetric?: (metric: string) => string | undefined;
};

const priceSql = `
  SELECT EXTRACT(EPOCH FROM time) AS time, metric, value
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
  args: [string, Date, Date, number[]],
  options: PriceSeriesOptions = {},
) {
  const rows = await chartQuery<TimeMetricValueRow>(request, priceSql, args);
  const series: UplotSeriesDesc[] = [];
  let currentSeries: UplotSeriesDesc | undefined;

  for (const row of rows) {
    const key = String(row.metric);
    if (currentSeries?.label !== key) {
      currentSeries = newPriceSeries(key, options);
      series.push(currentSeries);
    }
    currentSeries.data.push(row.value);
  }

  return series;
}

function newPriceSeries(key: string, options: PriceSeriesOptions = {}): UplotSeriesDesc {
  const color = options.colorForMetric?.(key) || getColorForPrice(key);
  return {
    label: key,
    stroke: color,
    width: 2,
    scale: options.scale,
    data: [],
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
