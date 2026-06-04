import type { FastifyRequest } from "fastify";
import { chartQuery } from "./chartQuery.ts";
import type { Series, TimeMetricValueRow } from "./types.ts";

const loadSql = `
  SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, 'load' AS metric, SUM(value) AS value
  FROM (
    SELECT time_bucket_gapfill($1::interval, time) AS time, INTERPOLATE(AVG(value)) AS value
    FROM load l
    WHERE time BETWEEN $2 AND $3 AND
    area_id = ANY($4::int[])
    GROUP BY 1, area_id
  ) s
  GROUP BY 1
  ORDER BY 1
`;

export async function getLoadSeries(
  request: FastifyRequest,
  args: [string, Date, Date, number[], string],
) {
  const rows = await chartQuery<TimeMetricValueRow>(request, loadSql, args);
  const series: Series[] = [];
  let currentSeries: Series | undefined;

  for (const row of rows) {
    if (currentSeries?.name !== row.metric) {
      currentSeries = {
        name: row.metric,
        type: "line",
        unit: "power",
        symbol: "none",
        lineStyle: { width: 2, color: "#000" },
        itemStyle: { color: "#000" },
        data: [],
      };
      series.push(currentSeries);
    }
    currentSeries.data.push([row.time, row.value]);
  }

  return series;
}
