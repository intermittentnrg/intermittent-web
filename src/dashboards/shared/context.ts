import { querySmall } from "../../lib/db.js";
import type { DashboardParams } from "./types.js";

type AreaContext = {
  areaIds: number[];
  from: Date;
  to: Date;
  timezone: string;
  timezoneAbbreviation: string;
};

export async function getAreaContext(
  params: DashboardParams,
): Promise<AreaContext> {
  const [fromRaw, toRaw] = params.date_range
    .split("_to_")
    .map((part) => part?.replaceAll("_", " "));
  const from = parseAppDate(fromRaw, false);
  const to = parseAppDate(toRaw, true);

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
  };
}

function parseAppDate(value: string | undefined, end: boolean) {
  const now = new Date();
  if (!value || value === "now") return now;
  const match = value.match(
    /^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i,
  );
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const d = new Date(now);
    const multipliers: Record<string, number> = {
      minute: 60e3,
      hour: 3600e3,
      day: 86400e3,
      week: 7 * 86400e3,
    };
    if (unit in multipliers)
      return new Date(now.getTime() - amount * multipliers[unit]);
    if (unit === "month") d.setMonth(d.getMonth() - amount);
    if (unit === "year") d.setFullYear(d.getFullYear() - amount);
    return d;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    if (end) parsed.setHours(23, 59, 59, 999);
    return parsed;
  }
  throw new Error(`Could not parse date_range value: ${value}`);
}

function timezoneAbbr(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date());
  return parts.find((part) => part.type === "timeZoneName")?.value || timeZone;
}
