import type { FastifyReply, FastifyRequest } from "fastify";
import type { AreaRow, DashboardParams } from "./dashboards/shared/types.ts";
import { querySmall } from "./lib/db.ts";
import { dashboardPageTitle, dashboardTabGroups, dashboardHasFeature } from "./shared/dashboardCatalog.ts";

const datePresets = [
  { preset: "today", from: "today", to: "today", label: "Today" },
  { preset: "yesterday", from: "yesterday", to: "yesterday", label: "Yesterday" },
  { preset: "last_7_days", from: "7 days ago", to: "now", label: "Last 7 Days" },
  { preset: "last_30_days", from: "30 days ago", to: "now", label: "Last 30 Days" },
  { preset: "last_90_days", from: "90 days ago", to: "now", label: "Last 90 Days" },
  { preset: "previous_week", from: "last week", to: "last week", label: "Previous Week" },
  { preset: "previous_month", from: "last month", to: "last month", label: "Previous Month" },
  { preset: "previous_year", from: "last year", to: "last year", label: "Previous Year" },
  { preset: "last_year", from: "1 year ago", to: "now", label: "Last Year" },
  { preset: "last_5_years", from: "5 years ago", to: "now", label: "Last 5 Years" },
];

async function loadAreasData() {
  try {
    const rows = await querySmall<AreaRow>(
      "SELECT region, type, code, source FROM areas WHERE enabled='t' ORDER BY region, type, code",
    );

    const areasData: Record<string, Record<string, Array<{ code: string; source: string; label: string }>>> = {};
    const regions = new Set<string>();

    for (const row of rows) {
      regions.add(row.region);
      areasData[row.region] ||= {};
      areasData[row.region][row.type] ||= [];
      areasData[row.region][row.type].push({
        code: row.code,
        source: row.source,
        label: `${row.code} (${row.source})`,
      });
    }

    return { areasData, regions: [...regions].sort() };
  } catch (error) {
    throw new Error(`Failed to load areas from database. Check DATABASE_URL and schema. ${String(error)}`);
  }
}

export async function health(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ ok: true });
}

export async function dashboardSpa(request: FastifyRequest<{ Params: DashboardParams; Querystring: Record<string, string | undefined> }>, reply: FastifyReply) {
  const params = request.params;
  const query = request.query;
  const dashboardType = params.dashboard || "electricity_mix";
  const areas = await loadAreasData();

  const [fromPath = "7_days_ago", toPath = "now"] = params.date_range.split("_to_");
  const fromRaw = fromPath.replace(/_/g, " ");
  const toRaw = toPath.replace(/_/g, " ");
  const currentPreset = datePresets.find((preset) => preset.from === fromRaw && preset.to === toRaw);
  const unitLabelText = await unitLabel(query.units);

  return reply.view("dashboards/index.ejs", {
    pageTitle: dashboardPageTitle(dashboardType, params.region, params.area),
    imageUrl: absoluteUrl(request, echartsPngPath(params, dashboardType, query)),
    params: { ...params, ...query },
    dashboardType,
    productionType: productionTypeLabel(query.production_type),
    unitLabel: unitLabelText,
    prices: query.prices === "true" || query.prices === "1",
    temps: query.temps === "true" || query.temps === "1",
    load: query.load === "true" || query.load === "1",
    transmission: query.transmission !== "0",
    fromRaw,
    toRaw,
    datePresets,
    currentPreset,
    dashboardTabGroups,
    dashboardHasFeature,
    resolutions: ["5m", "15m", "30m", "1h", "6h", "12h", "1d", "1w", "1M"],
    ...areas,
  });
}

function productionTypeLabel(productionType?: string) {
  if (!productionType || productionType === "all") return "All";
  const types = productionType.split(",").filter(Boolean);
  if (types.length === 0 || types.includes("all")) return "All";
  if (types.length === 1) {
    return types[0].replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  return `${types.length} types`;
}

async function unitLabel(units?: string) {
  const ids = (units || "").split(",").map(Number).filter(Boolean);
  if (ids.length === 0) return "All";
  const rows = await querySmall<{ name: string }>(
    "SELECT COALESCE(name, internal_id) AS name FROM units WHERE id = ANY($1::int[]) ORDER BY array_position($1::int[], id)",
    [ids],
  );
  if (rows.length === 0) return "All";
  if (rows.length > 3) return `${rows.length} units`;
  return rows.map((row) => row.name).join(", ");
}

function echartsPngPath(params: DashboardParams, dashboardType: string, query: Record<string, string | undefined>) {
  const path = `/${params.region}/${params.area_type}/${params.area}/${params.date_range}/${dashboardType}.png`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "") search.set(key, value);
  }
  const queryString = search.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function absoluteUrl(request: FastifyRequest, path: string) {
  const proto = String(request.headers["x-forwarded-proto"] || "http").split(",")[0];
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || `localhost:${process.env.PORT || 3000}`).split(",")[0];
  return `${proto}://${host}${path}`;
}

export async function nordpool(_request: FastifyRequest, reply: FastifyReply) {
  return reply.view("stub.ejs", { pageTitle: "Nordpool", heading: "Nordpool", message: "Nordpool controller stub" });
}
