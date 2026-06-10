/**
 * Build uPlot-compatible options and data from series data.
 *
 * Stacking strategy:
 * 1. Group series by their `stack` property
 * 2. Within each group, accumulate values (running total)
 * 3. Add bands between consecutive cumulative series
 * 4. First series in a group fills from its values down to 0 (scale min)
 * 5. Non-stacked series (prices on secondary axis) are rendered as bare lines
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
  data: number[];
  stroke?: string;
  width?: number;
  fill?: string;
  /** Scale key: "y" (primary, power) or "%" (secondary, prices). Defaults to "y". */
  scale?: string;
  /** Stack group name. Series in the same group are cumulatively stacked. */
  stack?: string;
  dash?: number[];
  /** Rendering hint for the frontend: "line" (default for area/line), "bar", "scatter". */
  type?: "line" | "bar" | "scatter";
};

/** Pad a values array to a given length with nulls. */
function padTo(values: number[], length: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < length; i++) {
    out.push(i < values.length ? (values[i] ?? null) : null);
  }
  return out;
}

/**
 * @param ianaTimezone - IANA timezone name (e.g. "Europe/Stockholm"). Used to configure
 *   uPlot's tzDate for DST-correct display. The display abbreviation is derived automatically.
 */
export function buildUplotPayload(
  title: string,
  timestamps: number[],
  series: UplotSeriesDesc[],
  ianaTimezone: string,
): UplotPayload {
  const length = timestamps.length;
  const startTime = length > 0 ? timestamps[0] : 0;
  const interval = length > 1 ? timestamps[1] - timestamps[0] : 0;

  // ── Data columns: value series only (timestamps derived from startTime + interval * index) ──
  const data: (number | null)[][] = [];
  const rawData: (number | null)[][] = [];
  // uPlot expects opts.series[0] to be the x-axis entry (maps to data[0] = timestamps,
  // which the frontend rebuilds from startTime + interval * index).
  const uplotSeries: uPlot.Series[] = [{ label: "Time" }];
  const bands: uPlot.Band[] = [];
  const seriesMeta: UplotPayload["seriesMeta"] = [];

  // Separate series into stack groups and non-stacked
  const stackGroups = new Map<string, UplotSeriesDesc[]>();
  const nonStacked: UplotSeriesDesc[] = [];

  for (const s of series) {
    if (s.stack) {
      if (!stackGroups.has(s.stack)) stackGroups.set(s.stack, []);
      stackGroups.get(s.stack)!.push(s);
    } else {
      nonStacked.push(s);
    }
  }

  // ── Process each stack group ──
  for (const [_groupName, groupSeries] of stackGroups) {
    const accum: (number | null)[] = new Array(length).fill(0);

    for (let gi = 0; gi < groupSeries.length; gi++) {
      const s = groupSeries[gi];
      const raw = padTo(s.data, length);

      // Cumulative (for rendering)
      const cumCol: (number | null)[] = [];
      for (let i = 0; i < length; i++) {
        const a = accum[i];
        const r = raw[i];
        cumCol.push(a != null && r != null ? a + r : (r ?? a));
        accum[i] = cumCol[i];
      }

      data.push(cumCol);
      rawData.push(raw);

      const colIdx = data.length - 1;
      const isFirstInGroup = gi === 0;
      const usePrimaryScale = s.scale !== "%";

      const uS: uPlot.Series = {
        label: s.label,
        stroke: s.stroke,
        width: s.width ?? 1,
      };

      if (!usePrimaryScale) uS.scale = "%";

      if (s.type === "bar") {
        // For bars, every series needs fill — the frontend bars paths builder
        // reads bands to determine where each bar starts. Set fill on all.
        if (s.fill) uS.fill = s.fill;
      } else {
        // For areas, only first in stack group gets fill (bands handle the rest)
        if (isFirstInGroup && s.fill) uS.fill = s.fill;
      }

      uplotSeries.push(uS);
      seriesMeta.push({ type: s.type });

      // Bands for stacked series: areas fill between cumulative paths;
      // the bars path builder also reads bands to determine per-bar baseline.
      if (!isFirstInGroup && usePrimaryScale && s.fill) {
        // data has no timestamp column, but opts.series includes it at index 0.
        // uPlot's final series array = [Time, value1, value2, ...], so shift band indices by 1.
        bands.push({
          series: [colIdx + 1, colIdx],
          fill: s.fill,
        });
      }
    }
  }

  // ── Non-stacked series ──
  for (const s of nonStacked) {
    const vals = padTo(s.data, length);
    data.push(vals);
    rawData.push(vals);

    const uS: uPlot.Series = {
      label: s.label,
      stroke: s.stroke,
      width: s.width ?? 1,
    };

    if (s.scale === "%") uS.scale = "%";
    if (s.fill) uS.fill = s.fill;

    uplotSeries.push(uS);
    seriesMeta.push({ type: s.type });
  }

  // ── Axes ──
  const hasSecondary = series.some((s) => s.scale === "%");

  const axes: uPlot.Axis[] = [
    {
      stroke: "#888",
      grid: { stroke: "rgba(0,0,0,0.06)" },
      font: "12px system-ui, sans-serif",
    },
    {
      stroke: "#888",
      grid: { stroke: "rgba(0,0,0,0.06)" },
      font: "12px system-ui, sans-serif",
      scale: "y",
    },
  ];

  if (hasSecondary) {
    axes.push({
      stroke: "#888",
      grid: { show: false },
      font: "12px system-ui, sans-serif",
      side: 1,
      scale: "%",
      label: "€/MWh",
    });
  }

  const opts: Partial<uPlot.Options> = {
    title,
    scales: {
      x: { time: true },
    },
    cursor: {
      show: true,
      lock: false,
      focus: { prox: 10 },
    },
    select: {
      show: true,
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    },
    legend: {
      show: true,
    },
    series: uplotSeries,
    bands,
    axes,
  };

  const result: UplotPayload = {
    chartLibrary: "uplot",
    opts,
    data,
    rawData,
    startTime,
    interval,
    timezone: ianaTimezone,
  };
  if (seriesMeta.length > 0) result.seriesMeta = seriesMeta;
  return result;
}
