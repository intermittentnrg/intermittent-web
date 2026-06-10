import { querySmall } from "../../lib/db.ts";
import type { FastifyRequest } from "fastify";
import type { DashboardParams, DashboardQuery } from "./types.ts";
import { calculateResolution, resolutionToSeconds } from "../../shared/dateParsing.ts";
import { parseDateRangeInTimeZone } from "./timezoneDateRange.ts";

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
  const { from, to } = parseDateRangeInTimeZone(fromRaw, toRaw, timezone);

  return {
    areaIds,
    from,
    to,
    timezone,
    timezoneAbbreviation: timezoneAbbr(timezone),
    interval: req.query.resolution
      ? resolutionToSeconds(req.query.resolution, "15m")
      // For direct requests without an explicit resolution (e.g. social preview
      // cards), calculate the optimal resolution from the rendering width.
      : req.url.split("?", 1)[0].endsWith(".png")
        ? resolutionToSeconds(
            calculateResolution(from, to, 1200, req.query.min_resolution || "15m"),
            "15m",
          )
        : resolutionToSeconds(req.query.min_resolution, "15m"),
  };
}

function timezoneAbbr(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date());
  return parts.find((part) => part.type === "timeZoneName")?.value || timeZone;
}
