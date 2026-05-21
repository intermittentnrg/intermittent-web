import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "./lib/db.ts";

const legacyDashboardUidMappings: Record<string, string> = {
  rK5XnQ7Vz: "electricity_mix",
  QCEg6rl7z: "generation",
  "dd01537d-9d97-464a-ac10-3bf6e057e67c": "generation_min_max",
  ddj485n5eza4gd: "generation_total",
  "d85aa31b-fd17-484e-85bf-23bdc1ef5af2": "generation_yoy",
  bdhjgwdfjkwe8a: "simulation",
  "a6784fe6-f7e8-4c8b-83ed-1e8ccd8734a1": "demand",
  "d606c07d-78f6-4f4a-bffd-dd89bb7cddbc": "demand_min_max",
  "ed438e5f-3c21-4f76-b5c5-3b0083a998ba": "demand_yoy",
  "fd6ad7f2-a171-4781-99a0-3d5b8ebc34ce": "transmission",
  "ad1960c0-8a0d-478b-a54d-964ca3f771ac": "per_unit",
  bdkf9e861xu68a: "per_unit_total",
  "c2471171-d24f-4dee-a364-c28d412d3457": "per_unit_moving_capacity",
  K9D5N7Jnz: "prices",
};

type LegacyDashboardQuery = Record<string, string | string[] | undefined>;

export async function legacyDashboardRedirect(request: FastifyRequest<{ Params: { uid: string; dashboard: string }; Querystring: LegacyDashboardQuery }>, reply: FastifyReply) {
  const dashboard = legacyDashboardUidMappings[request.params.uid];
  if (!dashboard) return reply.code(404).send({ error: "Unknown legacy dashboard uid" });

  const query = request.query;
  const [region, areaType, area] = await legacyAreaTarget(request);
  const from = legacyDatePart(stringQuery(query.from), "from");
  const to = legacyDatePart(stringQuery(query.to), "to");
  const dateRange = `${from}_to_${to}`;

  const targetQuery = new URLSearchParams();
  setQuery(targetQuery, "min_interval", stringQuery(query["var-min_interval"]));
  if (truthyLegacyFlag(stringQuery(query["var-demand"]))) targetQuery.set("load", "1");
  if (truthyLegacyFlag(stringQuery(query["var-price"]))) targetQuery.set("prices", "1");

  const productionType = await legacyProductionType(stringQueryValues(query["var-production_type"]));
  if (productionType) targetQuery.set("production_type", productionType);

  const units = legacyCsvValues(stringQueryValues(query["var-unit"]));
  if (units) targetQuery.set("units", units);

  setQuery(targetQuery, "nuclear_multiplier", stringQuery(query["var-nuclear_multiply"]));
  setQuery(targetQuery, "wind_multiplier", stringQuery(query["var-wind_multiply"]));
  setQuery(targetQuery, "solar_multiplier", stringQuery(query["var-solar_multiply"]));
  setQuery(targetQuery, "demand_multiplier", stringQuery(query["var-demand_multiply"]));

  const queryString = targetQuery.toString();
  return reply.redirect(`/${region}/${areaType}/${area}/${dateRange}/${dashboard}${queryString ? `?${queryString}` : ""}`, 302);
}

function stringQuery(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[value.length - 1] : value;
}

function stringQueryValues(value: string | string[] | undefined) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function legacyCsvValues(values: string[]) {
  const cleanValues = values.flatMap((value) => value.split(",")).filter((value) => value && value !== "$__all" && value !== "all");
  return cleanValues.length ? cleanValues.join(",") : undefined;
}

function setQuery(params: URLSearchParams, key: string, value: string | undefined) {
  if (value && value !== "$__all" && value !== "all") params.set(key, value);
}

function truthyLegacyFlag(value: string | undefined) {
  return value === "1" || value === "true";
}

function legacyDatePart(value: string | undefined, side: "from" | "to") {
  if (!value || value === "now") return side === "to" ? "now" : "7_days_ago";
  const match = value.match(/^now-(\d+)([mhdwMy])$/);
  if (!match) return value.replace(/\s+/g, "_").replace(/-/g, "_");

  const [, amount, unit] = match;
  const units: Record<string, string> = { m: "minutes", h: "hours", d: "days", w: "weeks", M: "months", y: "years" };
  const unitName = units[unit] || "days";
  return `${amount}_${amount === "1" ? unitName.replace(/s$/, "") : unitName}_ago`;
}

async function legacyAreaTarget(request: FastifyRequest<{ Querystring: LegacyDashboardQuery }>) {
  const query = request.query;
  const fallbackRegion = stringQuery(query["var-region"]) || "usa";
  const fallbackAreaType = stringQuery(query["var-area_type"]) || "country";
  const rawValues = stringQueryValues(query["var-area"]);
  const values = rawValues.flatMap((value) => value.split(",")).filter(Boolean);
  if (!values.length || values.includes("$__all") || values.includes("all")) {
    return [fallbackRegion, fallbackAreaType, "all"] as const;
  }
  if (!values.every((value) => /^\d+$/.test(value))) {
    return [fallbackRegion, fallbackAreaType, values.join(",")] as const;
  }

  const ids = values.map(Number);
  const rows = await querySmall<{ id: number; region: string; type: string; code: string }>(
    "SELECT id, region, type, code FROM areas WHERE id = ANY($1::int[]) ORDER BY array_position($1::int[], id)",
    [ids],
  );
  if (!rows.length) return [fallbackRegion, fallbackAreaType, values.join(",")] as const;
  const sameRegion = rows.every((row) => row.region === rows[0].region);
  const sameAreaType = rows.every((row) => row.type === rows[0].type);
  return [
    sameRegion ? rows[0].region : fallbackRegion,
    sameAreaType ? rows[0].type : fallbackAreaType,
    rows.map((row) => row.code).join(","),
  ] as const;
}

async function legacyProductionType(rawValues: string[]) {
  const values = rawValues.flatMap((value) => value.split(",")).filter((value) => value && value !== "$__all" && value !== "all" && /^\d+$/.test(value));
  if (!values.length) return undefined;

  const ids = values.map(Number);
  const rows = await querySmall<{ name: string }>("SELECT name FROM production_types WHERE id = ANY($1::int[]) ORDER BY array_position($1::int[], id)", [ids]);
  return rows.map((row) => row.name).join(",") || undefined;
}
