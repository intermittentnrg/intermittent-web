import { describe, expect, it } from "vitest";
import { calculateResolution, parseAppDate, parseDateRange, resolutionToSeconds } from "../../src/shared/dateParsing.js";

const now = new Date("2025-02-15T12:00:00.000Z");
const iso = (date: Date) => date.toISOString();

describe("date parsing", () => {
  it("parses calendar year, month, and day boundaries", () => {
    expect(iso(parseAppDate("2025", { now }))).toBe("2025-01-01T00:00:00.000Z");
    expect(iso(parseAppDate("2025", { now, end: true }))).toBe("2025-12-31T23:59:59.999Z");
    expect(iso(parseAppDate("2025-01", { now }))).toBe("2025-01-01T00:00:00.000Z");
    expect(iso(parseAppDate("2025-01", { now, end: true }))).toBe("2025-01-31T23:59:59.999Z");
    expect(iso(parseAppDate("2025-01-15", { now }))).toBe("2025-01-15T00:00:00.000Z");
    expect(iso(parseAppDate("2025-01-15", { now, end: true }))).toBe("2025-01-15T23:59:59.999Z");
  });

  it("parses relative expressions and implies past for bare durations", () => {
    expect(iso(parseAppDate("7 days ago", { now }))).toBe("2025-02-08T12:00:00.000Z");
    expect(iso(parseAppDate("1 week ago", { now }))).toBe("2025-02-08T12:00:00.000Z");
    expect(iso(parseAppDate("1 week", { now }))).toBe("2025-02-08T12:00:00.000Z");
    expect(iso(parseAppDate("now", { now }))).toBe("2025-02-15T12:00:00.000Z");
  });

  it("parses common presets", () => {
    expect(iso(parseAppDate("today", { now }))).toBe("2025-02-15T00:00:00.000Z");
    expect(iso(parseAppDate("today", { now, end: true }))).toBe("2025-02-15T23:59:59.999Z");
    expect(iso(parseAppDate("yesterday", { now }))).toBe("2025-02-14T00:00:00.000Z");
    expect(iso(parseAppDate("last month", { now }))).toBe("2025-01-01T00:00:00.000Z");
    expect(iso(parseAppDate("last month", { now, end: true }))).toBe("2025-01-31T23:59:59.999Z");
  });

  it("parses ranges", () => {
    const range = parseDateRange("2025-01", "now", now);
    expect(iso(range.from)).toBe("2025-01-01T00:00:00.000Z");
    expect(iso(range.to)).toBe("2025-02-15T12:00:00.000Z");
  });
});

describe("resolution buckets", () => {
  it("selects cache-friendly buckets from date span and width", () => {
    expect(calculateResolution(new Date("2025-01-01T00:00:00Z"), new Date("2025-01-31T00:00:00Z"), 1440)).toBe("30m");
    expect(calculateResolution(new Date("2025-01-01T00:00:00Z"), new Date("2025-01-02T00:00:00Z"), 800)).toBe("5m");
    expect(calculateResolution(new Date("2020-01-01T00:00:00Z"), new Date("2025-01-01T00:00:00Z"), 1000)).toBe("1w");
  });

  it("converts resolution labels to seconds", () => {
    expect(resolutionToSeconds("5m")).toBe(300);
    expect(resolutionToSeconds("15m")).toBe(900);
    expect(resolutionToSeconds("not-a-bucket")).toBe(900);
  });
});
