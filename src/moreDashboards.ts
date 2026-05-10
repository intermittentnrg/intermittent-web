import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "./lib/db.js";
import { calculateInterval, getAreaContext, buildDualAxisOptions, type DashboardParams } from "./electricityMix.js";
import { buildChartOptions, getProductionTypeIds, getProductionTypeOptions, titleize } from "./sharedCharts.js";

type Query = { width?: string; min_interval?: string; production_type?: string; transmission?: string };
type Row = Record<string, any>;

const generationMinMaxSql = `
WITH _full_res AS (
  SELECT time_bucket_gapfill('15 minutes', time) AS time, INTERPOLATE(AVG(value)) AS value
  FROM generation
  WHERE time BETWEEN $2 AND $3 AND production_type_id = ANY($6::int[]) AND area_id = ANY($4::int[])
  GROUP BY 1, area_id, production_type_id
)
SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, avg_value, min_value, max_value
FROM (
  SELECT time_bucket($1::interval, time) AS time, AVG(value) * 1000 AS avg_value, MIN(value) * 1000 AS min_value, MAX(value) * 1000 AS max_value
  FROM (SELECT time, SUM(value) AS value FROM _full_res GROUP BY time) s
  WHERE value IS NOT NULL GROUP BY 1 ORDER BY 1
) s2`;

const demandMinMaxSql = `
WITH _full_res AS (
  SELECT time_bucket_gapfill('1 hour', time) AS time, INTERPOLATE(AVG(value)) AS value
  FROM load WHERE time BETWEEN $2 AND $3 AND area_id = ANY($4::int[]) GROUP BY 1, area_id
)
SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $5) * 1000 AS time, avg_value, min_value, max_value
FROM (
  SELECT time_bucket($1::interval, time) AS time, AVG(value) * 1000 AS avg_value, MIN(value) * 1000 AS min_value, MAX(value) * 1000 AS max_value
  FROM (SELECT time, SUM(value) AS value FROM _full_res GROUP BY time) s
  WHERE value IS NOT NULL GROUP BY 1 ORDER BY 1
) s2`;

const generationYoySql = `
SELECT EXTRACT(EPOCH FROM (time + ($5 - EXTRACT(YEAR FROM time) || ' years')::interval) AT TIME ZONE $4) * 1000 AS time,
       EXTRACT(YEAR FROM time)::text AS metric, SUM(value) AS value
FROM (
  SELECT time_bucket_gapfill($1::interval, time, start => '2015-01-01', finish => $2) AS time, AVG(value) AS value
  FROM generation_data_hourly g
  INNER JOIN areas_production_types apt ON g.areas_production_type_id = apt.id
  WHERE time BETWEEN '2015-01-01' AND $2 AND apt.production_type_id = ANY($6::int[]) AND apt.area_id = ANY($3::int[])
  GROUP BY 1, apt.area_id, apt.production_type_id
) s
GROUP BY 1, 2 ORDER BY 2, 1`;

const demandYoySql = `
SELECT EXTRACT(EPOCH FROM (time + ($5 - EXTRACT(YEAR FROM time) || ' years')::interval) AT TIME ZONE $4) * 1000 AS time,
       EXTRACT(YEAR FROM time)::text AS metric, SUM(value) AS value
FROM (
  SELECT time_bucket_gapfill($1::interval, time, start => '2015-01-01', finish => $2) AS time, AVG(value) AS value
  FROM load l WHERE time BETWEEN '2015-01-01' AND $2 AND area_id = ANY($3::int[]) GROUP BY 1, area_id
) s
GROUP BY 1, 2 ORDER BY 2, 1`;

export async function generationMinMax(req: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>, reply: FastifyReply) {
  const ctx = await getAreaContext(req.params); const interval = calculateInterval(ctx.from, ctx.to, req.query.width, req.query.min_interval);
  const ptIds = await getProductionTypeIds(ctx.areaIds, req.query.production_type);
  const rows = await querySmall<Row>(generationMinMaxSql, [`${interval} seconds`, ctx.from, ctx.to, ctx.areaIds, ctx.timezone, ptIds]);
  const options = buildChartOptions(buildMinMaxSeries(rows), "Generation Min/Max", "power");
  return reply.send({ options, height: 567, timezone: ctx.timezoneAbbreviation, production_types: await getProductionTypeOptions(ctx.areaIds) });
}

export async function demandMinMax(req: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>, reply: FastifyReply) {
  const ctx = await getAreaContext(req.params); const interval = calculateInterval(ctx.from, ctx.to, req.query.width, req.query.min_interval);
  const rows = await querySmall<Row>(demandMinMaxSql, [`${interval} seconds`, ctx.from, ctx.to, ctx.areaIds, ctx.timezone]);
  return reply.send({ options: buildChartOptions(buildMinMaxSeries(rows), "Demand Min/Max", "power"), height: 567, timezone: ctx.timezoneAbbreviation });
}

export async function generationYoy(req: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>, reply: FastifyReply) {
  const ctx = await getAreaContext(req.params); const interval = calculateYoyInterval(req.query.width, req.query.min_interval); const finish = new Date();
  const ptIds = await getProductionTypeIds(ctx.areaIds, req.query.production_type);
  const rows = await querySmall<Row>(generationYoySql, [`${interval} seconds`, finish, ctx.areaIds, ctx.timezone, finish.getFullYear(), ptIds]);
  return reply.send({ options: buildChartOptions(buildYoySeries(rows), "Generation Year over Year", "power"), height: 567, timezone: ctx.timezoneAbbreviation, production_types: await getProductionTypeOptions(ctx.areaIds) });
}

export async function demandYoy(req: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>, reply: FastifyReply) {
  const ctx = await getAreaContext(req.params); const interval = calculateYoyInterval(req.query.width, req.query.min_interval); const finish = new Date();
  const rows = await querySmall<Row>(demandYoySql, [`${interval} seconds`, finish, ctx.areaIds, ctx.timezone, finish.getFullYear()]);
  return reply.send({ options: buildChartOptions(buildYoySeries(rows), "Demand Year over Year", "power"), height: 567, timezone: ctx.timezoneAbbreviation });
}

const transmissionSql = (filtered: boolean) => `
WITH _transmission AS (
  SELECT time_bucket_gapfill('1h', time) AS time, from_area_id, to_area_id, INTERPOLATE(AVG(value)) AS value
  FROM transmission_data t INNER JOIN areas_areas aa ON(areas_area_id=aa.id)
  WHERE from_area_id = ANY($1::int[]) AND to_area_id = ANY($1::int[]) ${filtered ? 'AND from_area_id=$5 AND to_area_id=$6' : ''} AND time BETWEEN $2 AND $3 GROUP BY 1,2,3
UNION
  SELECT time_bucket_gapfill('1h', time) AS time, to_area_id AS from_area_id, from_area_id AS to_area_id, INTERPOLATE(-AVG(value)) AS value
  FROM transmission_data t INNER JOIN areas_areas aa ON(areas_area_id=aa.id)
  WHERE from_area_id = ANY($1::int[]) AND to_area_id = ANY($1::int[]) ${filtered ? 'AND from_area_id=$5 AND to_area_id=$6' : ''} AND time BETWEEN $2 AND $3 GROUP BY 1,2,3
)
SELECT EXTRACT(EPOCH FROM time AT TIME ZONE $4) * 1000 AS time, fa.code AS from_area, ta.code AS to_area, SUM(value) AS value
FROM _transmission INNER JOIN areas fa ON(from_area_id=fa.id) INNER JOIN areas ta ON(to_area_id=ta.id)
GROUP BY 1,2,3 ORDER BY 2,3,1`;

export async function transmission(req: FastifyRequest<{ Params: DashboardParams; Querystring: Query }>, reply: FastifyReply) {
  const ctx = await getAreaContext(req.params); const parts = req.query.transmission?.split('-').map(Number).filter(Boolean) || [];
  const filtered = parts.length === 2; const args: any[] = [ctx.areaIds, ctx.from, ctx.to, ctx.timezone]; if (filtered) args.push(parts[0], parts[1]);
  const rows = await querySmall<Row>(transmissionSql(filtered), args);
  const lines = await querySmall<Row>(`SELECT DISTINCT fa.code AS from_code, ta.code AS to_code, fa.id AS from_area_id, ta.id AS to_area_id FROM areas_areas aa INNER JOIN areas fa ON(aa.from_area_id=fa.id) INNER JOIN areas ta ON(aa.to_area_id=ta.id) WHERE from_area_id = ANY($1::int[]) OR to_area_id = ANY($1::int[]) ORDER BY from_code,to_code`, [ctx.areaIds]);
  return reply.send({ options: buildDualAxisOptions(buildTransmissionSeries(rows), "Transmission"), height: 567, timezone: ctx.timezoneAbbreviation, transmission_lines: lines.map(l => ({ id: `${l.from_area_id}-${l.to_area_id}`, label: `${l.from_code} → ${l.to_code}` })) });
}

function buildMinMaxSeries(rows: Row[]) { return [
  { name: 'Min', type: 'line', stack: 'confidence-band', symbol: 'none', lineStyle: { width: 0 }, data: rows.map(r => [Number(r.time), Number(r.min_value)]) },
  { name: 'Max', type: 'line', stack: 'confidence-band', symbol: 'none', lineStyle: { width: 0 }, areaStyle: { color: 'rgba(150, 150, 150, 0.3)' }, data: rows.map(r => [Number(r.time), Number(r.max_value) - Number(r.min_value)]) },
  { name: 'Average', type: 'line', symbol: 'none', lineStyle: { width: 2, color: 'rgb(150, 150, 150)' }, data: rows.map(r => [Number(r.time), Number(r.avg_value)]) }
] as any[]; }

function buildYoySeries(rows: Row[]) { const m = new Map<string, any>(); for (const r of rows) { const k=String(r.metric); if(!m.has(k)) m.set(k,{name:k,type:'line',symbol:'none',lineStyle:{width:2},data:[]}); m.get(k).data.push([Number(r.time), r.value == null ? null : Number(r.value)*1000]); } return [...m.values()]; }
function buildTransmissionSeries(rows: Row[]) { const m = new Map<string, any>(); for (const r of rows) { const k=`${r.from_area}-${r.to_area}`; if(!m.has(k)) { const imp = Number(r.value)>=0; m.set(k,{name:`${r.from_area} → ${r.to_area}`,type:'line',unit:'power',stack:imp?'import':'export',symbol:'none',areaStyle:{opacity:.75},lineStyle:{width:0},itemStyle:{color:imp?'rgba(163, 82, 204, 0.8)':'rgba(124, 46, 163, 0.8)'},data:[]}); } m.get(k).data.push([Number(r.time), r.value == null ? null : Number(r.value)*1000]); } return [...m.values()]; }
function calculateYoyInterval(widthValue?: string, minIntervalValue?: string) { const min = ({'1h':3600,'6h':21600,'12h':43200,'1d':86400,'1w':604800,'1M':2592000} as any)[minIntervalValue || '1d'] || 86400; const target = 31536000 / Math.max(Number(widthValue || 1000),1); if(target<=min) return min; return [3600,21600,43200,86400,172800,604800,2592000].filter(i=>i<=target).at(-1)||min; }
