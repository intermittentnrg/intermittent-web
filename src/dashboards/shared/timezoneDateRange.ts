import { parseAppDate, type ParsedDateRange } from "../../shared/dateParsing.ts";

export function parseDateRangeInTimeZone(
  fromValue: string | undefined,
  toValue: string | undefined,
  timeZone: string,
  now = new Date(),
): ParsedDateRange {
  return {
    from: parseDateInTimeZone(fromValue, { end: false, now, timeZone }),
    to: parseDateInTimeZone(toValue, { end: true, now, timeZone }),
  };
}

function parseDateInTimeZone(
  value: string | undefined,
  options: { end: boolean; now: Date; timeZone: string },
) {
  const input = (value || "now").trim().toLowerCase();

  if (input === "now") return options.now;
  if (input === "today") return zonedDayBoundary(options.now, options.end, options.timeZone);
  if (input === "yesterday") {
    const parts = datePartsInTimeZone(options.now, options.timeZone);
    return zonedDateBoundary(parts.year, parts.month, parts.day - 1, options.end, options.timeZone);
  }

  const dateOnly = input.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = dateOnly[2] ? Number(dateOnly[2]) - 1 : 0;
    const day = dateOnly[3] ? Number(dateOnly[3]) : 1;
    if (!dateOnly[2]) return zonedDateBoundary(year, 0, 1, options.end, options.timeZone, 12);
    if (!dateOnly[3]) return zonedDateBoundary(year, month, 1, options.end, options.timeZone, 1);
    return zonedDateBoundary(year, month, day, options.end, options.timeZone);
  }

  return parseAppDate(value, { end: options.end, now: options.now });
}

function zonedDayBoundary(date: Date, end: boolean, timeZone: string) {
  const parts = datePartsInTimeZone(date, timeZone);
  return zonedDateBoundary(parts.year, parts.month, parts.day, end, timeZone);
}

function zonedDateBoundary(
  year: number,
  month: number,
  day: number,
  end: boolean,
  timeZone: string,
  durationMonths = 0,
) {
  const start = zonedMidnight(year, month, day, timeZone);
  if (!end) return start;

  const next = durationMonths > 0
    ? zonedMidnight(year, month + durationMonths, day, timeZone)
    : zonedMidnight(year, month, day + 1, timeZone);
  return new Date(next.getTime() - 1);
}

function zonedMidnight(year: number, month: number, day: number, timeZone: string) {
  const utc = new Date(Date.UTC(year, month, day));
  return new Date(utc.getTime() - timezoneOffsetMs(utc, timeZone));
}

function timezoneOffsetMs(date: Date, timeZone: string) {
  const parts = datePartsInTimeZone(date, timeZone);
  return Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
}

function datePartsInTimeZone(date: Date, timeZone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month) - 1,
    day: Number(values.day),
    hour: Number(values.hour || 0),
    minute: Number(values.minute || 0),
    second: Number(values.second || 0),
  };
}
