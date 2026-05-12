import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "../lib/db.js";
import { chartQuery } from "./shared/chartQuery.js";
import { getAreaContext } from "./shared/context.js";
import { buildDualAxisOptions } from "./shared/chartOptions.js";
import type { AnyRow, DashboardParams, DashboardQuery } from "./shared/types.js";

const transmissionSql = (filtered: boolean) => `
WITH _transmission AS (
  SELECT time_bucket_gapfill('1h', time) AS time, from_area_id, to_area_id, INTERPOLATE(AVG(value)) AS value
  FROM transmission_data t INNER JOIN areas_areas aa ON(areas_area_id=aa.id)
  WHERE from_area_id = ANY($1::int[]) AND to_area_id = ANY($1::int[]) ${filtered ? "AND from_area_id=$5 AND to_area_id=$6" : ""} AND time BETWEEN $2 AND $3 GROUP BY 1,2,3
UNION
  SELECT time_bucket_gapfill('1h', time) AS time, to_area_id AS from_area_id, from_area_id AS to_area_id, INTERPOLATE(-AVG(value)) AS value
  FROM transmission_data t INNER JOIN areas_areas aa ON(areas_area_id=aa.id)
  WHERE from_area_id = ANY($1::int[]) AND to_area_id = ANY($1::int[]) ${filtered ? "AND from_area_id=$5 AND to_area_id=$6" : ""} AND time BETWEEN $2 AND $3 GROUP BY 1,2,3
)
SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $4) * 1000 AS time, fa.code AS from_area, ta.code AS to_area, SUM(value) AS value
FROM _transmission INNER JOIN areas fa ON(from_area_id=fa.id) INNER JOIN areas ta ON(to_area_id=ta.id)
GROUP BY 1,2,3 ORDER BY 2,3,1`;

export async function transmission(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getAreaContext(req.params);
  const parts =
    req.query.transmission?.split("-").map(Number).filter(Boolean) || [];
  const filtered = parts.length === 2;
  const args: any[] = [ctx.areaIds, ctx.from, ctx.to, ctx.timezone];
  if (filtered) args.push(parts[0], parts[1]);
  const rows = await chartQuery<AnyRow>(req, transmissionSql(filtered), args);
  const lines = await querySmall<AnyRow>(
    `SELECT DISTINCT fa.code AS from_code, ta.code AS to_code, fa.id AS from_area_id, ta.id AS to_area_id FROM areas_areas aa INNER JOIN areas fa ON(aa.from_area_id=fa.id) INNER JOIN areas ta ON(aa.to_area_id=ta.id) WHERE from_area_id = ANY($1::int[]) OR to_area_id = ANY($1::int[]) ORDER BY from_code,to_code`,
    [ctx.areaIds],
  );
  return reply.send({
    options: buildDualAxisOptions(
      buildTransmissionSeries(rows),
      "Transmission",
    ),
    height: 567,
    timezone: ctx.timezoneAbbreviation,
    transmission_lines: lines.map((l) => ({
      id: `${l.from_area_id}-${l.to_area_id}`,
      label: `${l.from_code} → ${l.to_code}`,
    })),
  });
}

function buildTransmissionSeries(rows: AnyRow[]) {
  const m = new Map<string, any>();
  for (const r of rows) {
    const k = `${r.from_area}-${r.to_area}`;
    if (!m.has(k)) {
      const imp = Number(r.value) >= 0;
      m.set(k, {
        name: `${r.from_area} → ${r.to_area}`,
        type: "line",
        unit: "power",
        stack: imp ? "import" : "export",
        symbol: "none",
        areaStyle: { opacity: 0.75 },
        lineStyle: { width: 0 },
        itemStyle: {
          color: imp ? "rgba(163, 82, 204, 0.8)" : "rgba(124, 46, 163, 0.8)",
        },
        data: [],
      });
    }
    m.get(k).data.push([
      Number(r.time),
      r.value == null ? null : Number(r.value) * 1000,
    ]);
  }
  return [...m.values()];
}
