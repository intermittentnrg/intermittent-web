export type ParsedDateRange = {
  from: Date;
  to: Date;
};

export type Resolution = "5m" | "15m" | "30m" | "1h" | "6h" | "12h" | "1d" | "1w" | "1M";

export {
  RESOLUTION_BUCKETS,
  calculateResolution,
  parseAppDate,
  parseDateRange,
  resolutionToSeconds,
} from "./dateParsing.js";
