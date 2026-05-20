import { querySmall } from "../../lib/db.js";
import type { FastifyRequest } from "fastify";
import type { DashboardParams, DashboardQuery } from "./types.js";
import { parseDateRange, resolutionToSeconds } from "../../shared/dateParsing.js";

type Context = {
  areaIds: number[];
  from: Date;
  to: Date;
  timezone: string;
  timezoneAbbreviation: string;
  interval: number;
};

type DashboardRequest = FastifyRequest<{
  Params: DashboardParams;
  Querystring: DashboardQuery;
}>;

export async function getContext(
  req: DashboardRequest,
  paramOverrides: Partial<DashboardParams> = {},
): Promise<Context> {
  const params = { ...req.params, ...paramOverrides };
  const [fromRaw, toRaw] = params.date_range
    .split("_to_")
    .map((part) => part?.replaceAll("_", " "));
  const { from, to } = parseDateRange(fromRaw, toRaw);

  const areaCodes = params.area
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  const allAreas = areaCodes.length === 0 || areaCodes.includes("all");
  const areaRows = allAreas
    ? await querySmall<{ id: number }>(
        "SELECT id FROM areas WHERE region=$1 AND type=$2 AND enabled='t'",
        [params.region, params.area_type],
      )
    : await querySmall<{ id: number }>(
        "SELECT id FROM areas WHERE code = ANY($1::text[]) AND region=$2 AND type=$3 AND enabled='t'",
        [areaCodes, params.region, params.area_type],
      );
  const areaIds = areaRows.map((row) => row.id);

  const [tz] = await querySmall<{ timezone: string }>(
    "SELECT timezone FROM areas WHERE id = ANY($1::int[]) ORDER BY timezone_priority LIMIT 1",
    [areaIds],
  );
  const timezone = tz?.timezone || "UTC";

  return {
    areaIds,
    from,
    to,
    timezone,
    timezoneAbbreviation: timezoneAbbr(timezone),
    interval: resolutionToSeconds(req.query.resolution, "15m"),
  };
}

function timezoneAbbr(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date());
  return parts.find((part) => part.type === "timeZoneName")?.value || timeZone;
}
