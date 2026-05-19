import type { FastifyReply, FastifyRequest } from "fastify";

type GeoipTarget = { region: string; type: string; code: string };

const defaultTarget: GeoipTarget = { region: "usa", type: "country", code: "US48" };

const allRegionTargets: Record<string, GeoipTarget> = {
  AU: { region: "australia", type: "region", code: "all" },
  BR: { region: "brazil", type: "region", code: "all" },
};

const regionCodeMappings: Record<string, Record<string, string>> = {
  AU: { NSW: "NSW1", QLD: "QLD1", SA: "SA1", TAS: "TAS1", VIC: "VIC1", WA: "WEM", NT: "all", ACT: "all" },
  CA: { ON: "CA-ON", AB: "CA-AB" },
};

const countryTargets: Record<string, GeoipTarget> = {
  AR: { region: "argentina", type: "country", code: "AR" },
  DE: { region: "europe", type: "country", code: "DE" },
  FR: { region: "europe", type: "country", code: "FR" },
  GB: { region: "europe", type: "country", code: "GB" },
  MX: { region: "mexico", type: "country", code: "MX" },
  TW: { region: "taiwan", type: "country", code: "TW" },
  US: { region: "usa", type: "country", code: "US48" },
  ZA: { region: "south_africa", type: "country", code: "ZA" },
};

const regionalTargetRegions: Record<string, string> = {
  CA: "canada",
};

const specialFallbacks: Record<string, GeoipTarget> = {
  GG: { region: "europe", type: "country", code: "GB" },
  JE: { region: "europe", type: "country", code: "GB" },
  IM: { region: "europe", type: "country", code: "GB" },
};

const continentFallbacks: Record<string, GeoipTarget> = {
  EU: { region: "europe", type: "country", code: "all" },
  NA: { region: "usa", type: "country", code: "US48" },
  SA: { region: "brazil", type: "region", code: "all" },
  AS: { region: "japan", type: "region", code: "all" },
  AF: { region: "south_africa", type: "country", code: "ZA" },
  OC: { region: "australia", type: "region", code: "all" },
  AN: { region: "usa", type: "country", code: "US48" },
};

export async function geoipRedirect(request: FastifyRequest, reply: FastifyReply) {
  const target = resolveGeoipTarget(request);
  return reply.redirect(`/${target.region}/${target.type}/${target.code}/7_days_ago_to_now/electricity_mix`, 302);
}

export function resolveGeoipTarget(request: Pick<FastifyRequest, "headers">): GeoipTarget {
  const headers = request.headers;
  const continent = String(headers["cf-ipcontinent"] || "").toUpperCase();
  const country = String(headers["cf-ipcountry"] || "").toUpperCase();
  const regionCode = String(headers["cf-region-code"] || "").toUpperCase();

  const mappedRegion = regionCodeMappings[country]?.[regionCode];
  const fallbackTarget = specialFallbacks[country] || continentFallbacks[continent] || defaultTarget;
  let target = countryTargets[country] || fallbackTarget;

  if (mappedRegion === "all" && allRegionTargets[country]) {
    target = allRegionTargets[country];
  } else if (mappedRegion) {
    target = { region: regionalTargetRegions[country] || target.region, type: "region", code: mappedRegion };
  } else if (allRegionTargets[country]) {
    target = allRegionTargets[country];
  }

  return target;
}
