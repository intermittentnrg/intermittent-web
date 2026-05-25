import type { FastifyReply, FastifyRequest } from "fastify";
import { querySmall } from "./lib/db.ts";

type GeoipTarget = { region: string; type: string; code: string };

const defaultTarget: GeoipTarget = { region: "usa", type: "country", code: "US48" };

const allRegionTargets: Record<string, GeoipTarget> = {
  AU: { region: "australia", type: "region", code: "all" },
  BR: { region: "brazil", type: "region", code: "all" },
};

const regionCodeMappings: Record<string, Record<string, string>> = {
  AU: { NSW: "NSW1", QLD: "QLD1", SA: "SA1", TAS: "TAS1", VIC: "VIC1", WA: "WEM", NT: "all", ACT: "all" },
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
  const target = await resolveGeoipTarget(request);
  return reply.redirect(`/${target.region}/${target.type}/${target.code}/7_days_ago_to_now/electricity_mix`, 302);
}

export async function resolveGeoipTarget(request: Pick<FastifyRequest, "headers">): Promise<GeoipTarget> {
  const headers = request.headers;
  const continent = String(headers["cf-ipcontinent"] || "").toUpperCase();
  const country = String(headers["cf-ipcountry"] || "").toUpperCase();
  const regionCode = String(headers["cf-region-code"] || "").toUpperCase();

  return (
    (await areaByRegion(country, regionCode)) ||
    (await areaByCountry(country)) ||
    specialFallbacks[country] ||
    continentFallbacks[continent] ||
    defaultTarget
  );
}

async function areaByRegion(country: string, regionCode: string): Promise<GeoipTarget | undefined> {
  if (!country || !regionCode) return undefined;

  const mapping = regionCodeMappings[country]?.[regionCode];
  if (mapping === "all") return allRegionTargets[country];

  return findEnabledArea(mapping || `${country}-${regionCode}`, ["country", "region"]);
}

async function areaByCountry(country: string): Promise<GeoipTarget | undefined> {
  if (!country) return undefined;

  return findEnabledArea(country, ["country"]);
}

async function findEnabledArea(code: string, types: string[]): Promise<GeoipTarget | undefined> {
  const [area] = await querySmall<GeoipTarget>(
    "SELECT region, type, code FROM areas WHERE code=$1 AND type::text = ANY($2::text[]) AND enabled='t' LIMIT 1",
    [code, types],
  );

  return area;
}
