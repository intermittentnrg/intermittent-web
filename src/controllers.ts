import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "./lib/db.js";

type DashboardParams = {
  region: string;
  area_type: string;
  area: string;
  date_range: string;
  dashboard?: string;
};

type AreaRow = {
  region: string;
  type: string;
  code: string;
  source: string;
};

const productionDashboards = new Set([
  "generation",
  "generation_min_max",
  "generation_total",
  "generation_yoy",
  "capture_price",
  "simulations",
]);

const perUnitDashboards = new Set([
  "per_unit",
  "per_unit_peak",
  "per_unit_total",
  "per_unit_moving_capacity",
]);

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

    return { areasData, regions: [...regions].sort(), areasJson: JSON.stringify(areasData) };
  } catch (error) {
    throw new Error(`Failed to load areas from database. Check DATABASE_URL and schema. ${String(error)}`);
  }
}

export async function health(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ ok: true });
}

export async function geoipRedirect(request: FastifyRequest, reply: FastifyReply) {
  const headers = request.headers;
  const continent = String(headers["cf-ipcontinent"] || "").toUpperCase();
  const country = String(headers["cf-ipcountry"] || "").toUpperCase();
  const regionCode = String(headers["cf-region-code"] || "").toUpperCase();

  const allRegionTargets: Record<string, { region: string; type: string; code: string }> = {
    AU: { region: "australia", type: "region", code: "all" },
    BR: { region: "brazil", type: "region", code: "all" },
  };
  const regionCodeMappings: Record<string, Record<string, string>> = {
    AU: { NSW: "NSW1", QLD: "QLD1", SA: "SA1", TAS: "TAS1", VIC: "VIC1", WA: "WEM", NT: "all", ACT: "all" },
  };
  const specialFallbacks: Record<string, { region: string; type: string; code: string }> = {
    GG: { region: "europe", type: "country", code: "GB" },
    JE: { region: "europe", type: "country", code: "GB" },
    IM: { region: "europe", type: "country", code: "GB" },
  };
  const continentFallbacks: Record<string, { region: string; type: string; code: string }> = {
    EU: { region: "europe", type: "country", code: "all" },
    NA: { region: "usa", type: "country", code: "US48" },
    SA: { region: "brazil", type: "region", code: "all" },
    AS: { region: "japan", type: "region", code: "all" },
    AF: { region: "south_africa", type: "country", code: "ZA" },
    OC: { region: "australia", type: "region", code: "all" },
    AN: { region: "usa", type: "country", code: "US48" },
  };

  let target = specialFallbacks[country] || continentFallbacks[continent] || { region: "usa", type: "country", code: "US48" };

  const mappedRegion = regionCodeMappings[country]?.[regionCode];
  if (mappedRegion === "all" && allRegionTargets[country]) {
    target = allRegionTargets[country];
  } else if (mappedRegion) {
    target = { region: target.region, type: "region", code: mappedRegion };
  } else if (allRegionTargets[country]) {
    target = allRegionTargets[country];
  }

  return reply.redirect(`/${target.region}/${target.type}/${target.code}/7_days_ago_to_now/electricity_mix`, 302);
}

export async function dashboardSpa(request: FastifyRequest<{ Params: DashboardParams; Querystring: Record<string, string | undefined> }>, reply: FastifyReply) {
  const params = request.params;
  const query = request.query;
  const dashboardType = params.dashboard || "electricity_mix";
  const areas = await loadAreasData();

  return reply.view("dashboards/index.ejs", {
    pageTitle: `${dashboardType} - ${params.area}`,
    params: { ...params, ...query },
    dashboardType,
    productionType: query.production_type,
    prices: query.prices === "true" || query.prices === "1",
    temps: query.temps === "true" || query.temps === "1",
    load: query.load === "true" || query.load === "1",
    productionDashboards,
    perUnitDashboards,
    fromRaw: params.date_range.split("_to_")[0] || "7 days ago",
    toRaw: params.date_range.split("_to_")[1] || "now",
    timezoneInfo: { abbreviation: "UTC" },
    datePresets: [
      { preset: "last_24_hours", label: "Last 24 hours", from: "24 hours ago", to: "now" },
      { preset: "last_7_days", label: "Last 7 days", from: "7 days ago", to: "now" },
      { preset: "last_30_days", label: "Last 30 days", from: "30 days ago", to: "now" },
      { preset: "custom", label: "Custom", from: params.date_range.split("_to_")[0] || "", to: params.date_range.split("_to_")[1] || "" },
    ],
    currentPreset: { preset: "last_7_days", label: "Last 7 days" },
    intervals: ["5m", "15m", "30m", "1h", "6h", "12h", "1d", "1w", "1M"],
    ...areas,
  });
}

export async function apiStub(request: FastifyRequest<{ Params: DashboardParams & { endpoint: string } }>, reply: FastifyReply) {
  reply.code(501);
  return {
    error: "not_implemented",
    endpoint: request.params.endpoint,
    params: request.params,
    message: "Stub copied from Rails route; port the matching Api::*Controller query next.",
  };
}

export async function imageStub(request: FastifyRequest<{ Params: DashboardParams }>, reply: FastifyReply) {
  reply.code(501);
  return reply.send({ error: "not_implemented", message: "Dashboard image rendering stub", params: request.params });
}

export async function nordpool(_request: FastifyRequest, reply: FastifyReply) {
  return reply.view("stub.ejs", { pageTitle: "Nordpool", heading: "Nordpool", message: "Nordpool controller stub" });
}
