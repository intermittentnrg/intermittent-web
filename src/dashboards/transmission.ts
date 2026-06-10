import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "../lib/db.ts";
import { chartQuery } from "./shared/chartQuery.ts";
import { getContext } from "./shared/context.ts";
import { sendUplotResponse } from "./shared/chartResponse.ts";
import type { UplotSeriesDesc } from "./shared/uplotOptions.ts";
import type { AnyRow, DashboardParams, DashboardQuery } from "./shared/types.ts";

const transmissionSql = (filtered: boolean) => {
  const forwardWhere = filtered
    ? "concat_ws('-', from_area_id, to_area_id) = ANY($1::text[])"
    : "from_area_id = ANY($1::int[])";
  const reverseWhere = filtered
    ? "concat_ws('-', to_area_id, from_area_id) = ANY($1::text[])"
    : "to_area_id = ANY($1::int[])";
  const fromParam = "$2";
  const toParam = "$3";

  return `
  WITH _transmission AS (
    SELECT
      time_bucket_gapfill('1h', time) AS time,
      from_area_id,
      to_area_id,
      INTERPOLATE(AVG(value)) AS value
    FROM transmission_data t
    INNER JOIN areas_areas aa ON(areas_area_id=aa.id)
    WHERE
      ${forwardWhere} AND
      time BETWEEN ${fromParam} AND ${toParam}
    GROUP BY 1,2,3
  UNION
    SELECT
      time_bucket_gapfill('1h', time) AS time,
      to_area_id AS from_area_id,
      from_area_id AS to_area_id,
      INTERPOLATE(-AVG(value)) AS value
    FROM transmission_data t
    INNER JOIN areas_areas aa ON(areas_area_id=aa.id)
    WHERE
      ${reverseWhere} AND
      time BETWEEN ${fromParam} AND ${toParam}
    GROUP BY 1,2,3
  )
  SELECT EXTRACT(EPOCH FROM time) AS time, fa.code AS from_area, ta.code AS to_area, SUM(value) AS value
  FROM _transmission INNER JOIN areas fa ON(from_area_id=fa.id) INNER JOIN areas ta ON(to_area_id=ta.id)
  GROUP BY 1,2,3 ORDER BY 2,3,1
`;
};

export async function transmission(
  req: FastifyRequest<{ Params: DashboardParams; Querystring: DashboardQuery }>,
  reply: FastifyReply,
) {
  const ctx = await getContext(req);
  const selectedLines = req.query.transmission_lines?.split(",").filter(Boolean) || [];
  const filtered = selectedLines.length > 0;
  const args: any[] = filtered
    ? [selectedLines, ctx.from, ctx.to]
    : [ctx.areaIds, ctx.from, ctx.to];
  const rows = await chartQuery<AnyRow>(req, transmissionSql(filtered), args);
  const lines = await querySmall<AnyRow>(`
    SELECT DISTINCT
      CASE WHEN from_area_id = ANY($1::int[]) THEN fa.code ELSE ta.code END AS from_code,
      CASE WHEN from_area_id = ANY($1::int[]) THEN ta.code ELSE fa.code END AS to_code,
      CASE WHEN from_area_id = ANY($1::int[]) THEN fa.id ELSE ta.id END AS from_area_id,
      CASE WHEN from_area_id = ANY($1::int[]) THEN ta.id ELSE fa.id END AS to_area_id
    FROM areas_areas
    INNER JOIN areas fa ON(from_area_id=fa.id)
    INNER JOIN areas ta ON(to_area_id=ta.id)
    WHERE from_area_id = ANY($1::int[]) OR to_area_id = ANY($1::int[])
    ORDER BY from_code,to_code
    `,
    [ctx.areaIds],
  );
  const startTime = rows[0]?.time as number | undefined;
  const interval = ctx.interval;
  const mainSeries = buildTransmissionSeries(rows);

  if (startTime == null || mainSeries.length === 0) {
    return sendUplotResponse(req, reply, {
      title: "Transmission",
      mainSeries: [],
      startTime: 0,
      interval: 0,
      timezone: ctx.timezone,
    });
  }
  return sendUplotResponse(req, reply, {
    title: "Transmission",
    mainSeries,
    startTime,
    interval,
    timezone: ctx.timezone,
  }, {
    transmission_lines: lines.map((l) => ({
      id: `${l.from_area_id}-${l.to_area_id}`,
      label: `${l.from_code} → ${l.to_code}`,
    })),
  });
}

function buildTransmissionSeries(rows: AnyRow[]): UplotSeriesDesc[] {
  const m = new Map<string, UplotSeriesDesc>();
  for (const r of rows) {
    const k = `${r.from_area}-${r.to_area}`;
    if (!m.has(k)) {
      m.set(k, {
        label: `${r.from_area} → ${r.to_area}`,
        width: 0,
        fill: "rgba(124, 46, 163, 0.75)",
        data: [],
      });
    }
    m.get(k)!.data.push(r.value == null ? null! : Number(r.value));
  }
  return [...m.values()];
}
