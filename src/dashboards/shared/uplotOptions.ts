/**
 * uPlot payload builder — builds uPlot-compatible options and data from series data.
 *
 * The runtime implementation lives in the shared .js module so it can be used
 * by both backend (TypeScript) and browser (esbuild).
 */

import type uPlot from "uplot";

export type UplotPayload = {
  chartLibrary: "uplot";
  /** uPlot options — width/height are set by frontend, tzDate is constructed from payload.timezone. */
  opts: Partial<uPlot.Options>;
  /** Cumulative data columns (value series only — timestamps derived from startTime + interval * index). */
  data: (number | null)[][];
  /** Raw (non-cumulative) values for tooltips, same shape as data. */
  rawData: (number | null)[][];
  /** IANA timezone name (e.g. "Europe/Stockholm") for uPlot tzDate configuration. */
  timezone?: string;
  /** Start time (epoch seconds) of the first data point. */
  startTime: number;
  /** Interval between data points in seconds. */
  interval: number;
  /** Per-series rendering hints (one entry per data column, parallel to opts.series). */
  seriesMeta?: Array<{ type?: "line" | "bar" | "scatter" }>;
};

/**
 * uPlot-native series descriptor produced by series helpers.
 *
 * Properties use uPlot naming conventions (stroke, fill, width, scale) directly.
 * `data` holds the raw (non-cumulative) values; `stack` controls accumulation.
 */
export type UplotSeriesDesc = {
  label: string;
  data: (number | null)[];
  stroke?: string;
  width?: number;
  fill?: string;
  /** Scale key: "y" (power), "price-l", "price-r", "percent", "energy". Defaults to "y" (power). */
  scale?: string;
  /** Stack group name. Series in the same group are cumulatively stacked. */
  stack?: string;
  dash?: number[];
  /** Rendering hint for the frontend: "line" (default for area/line), "bar", "scatter". */
  type?: "line" | "bar" | "scatter";
};

// Re-export the runtime implementation from the shared .js module.
export { buildUplotOpts, stackGroup } from "../../shared/uplotOpts.js";
