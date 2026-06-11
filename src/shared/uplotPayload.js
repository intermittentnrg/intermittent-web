/**
 * uPlot payload builder — pure functions to build uPlot-compatible options and
 * data from series descriptors.  Works in both Node.js (backend) and browser.
 */

/** Pad a values array to a given length with nulls. */
function padTo(values, length) {
  const out = [];
  for (let i = 0; i < length; i++) {
    out.push(i < values.length ? (values[i] ?? null) : null);
  }
  return out;
}

/**
 * Accumulate raw values within a single stack group and produce cumulative
 * data columns, raw data columns, and uPlot band descriptors.
 *
 * @param {object[]} group - Series in the group (draw order).
 *   Each must have `{ data: number[], fill?: string }`.
 * @param {number} length - Number of time points.
 * @param {number} startUplotIdx - uPlot series index of the first series
 *   in this group (1-based; series[0] is the x-axis).
 * @returns {{ cols: number[][], rawCols: number[][], bands: object[] }}
 */
export function stackGroup(group, length, startUplotIdx) {
  const isNeg = group.some(s => s.data?.some(v => v != null && v < 0)) ?? false;
  const accum = new Array(length).fill(0);
  const cols = [];
  const rawCols = [];
  const bands = [];

  for (let gi = 0; gi < group.length; gi++) {
    const s = group[gi];
    const raw = padTo(s.data, length);
    const col = new Array(length);
    for (let i = 0; i < length; i++) {
      const a = accum[i];
      const r = raw[i];
      col[i] = a != null && r != null ? a + r : (r ?? a);
      accum[i] = col[i];
    }
    cols.push(col);
    rawCols.push(raw);

    if (gi > 0 && s.fill) {
      bands.push({
        series: [startUplotIdx + gi, startUplotIdx + gi - 1],
        fill: s.fill,
        ...(isNeg ? { dir: 1 } : {}),
      });
    }
  }

  return { cols, rawCols, bands };
}

/**
 * Build uPlot-compatible options (series descriptors, axes, scales, etc.)
 * from pre-computed data and bands.
 *
 * @param {string} title - Chart title.
 * @param {number[]} timestamps - Unix-epoch-second timestamps (for x-axis span).
 * @param {object[]} uplotSeries - uPlot series descriptors (one per data column,
 *   excluding the x-axis series). Must have `label`, `stroke`, `width`, etc.
 * @param {object[]} bands - uPlot band descriptors.
 * @param {string} [currencySymbol="€"] - Currency symbol for axis labels.
 * @returns {{ opts: object, startTime: number, interval: number }}
 */
export function buildUplotOpts(title, timestamps, uplotSeries, bands, currencySymbol = "€") {
  const length = timestamps.length;
  const startTime = length > 0 ? timestamps[0] : 0;
  const interval = length > 1 ? timestamps[1] - timestamps[0] : 0;

  // Determine which axes are needed
  const dataSeries = uplotSeries.slice(1);
  const hasPower = dataSeries.some((s) => !s.scale || s.scale === "y" || s.scale === "power");
  const hasPriceL = dataSeries.some((s) => s.scale === "price-l");
  const hasPriceR = dataSeries.some((s) => s.scale === "price-r");
  const hasPercent = dataSeries.some((s) => s.scale === "percent");
  const hasEnergy = dataSeries.some((s) => s.scale === "energy");

  const axes = [
    {
      stroke: "#888",
      grid: { stroke: "rgba(0,0,0,0.06)" },
      font: "12px system-ui, sans-serif",
    },
  ];

  // Primary left axis
  if (hasPower || hasEnergy || hasPriceL) {
    const scale = hasPower ? "y" : (hasEnergy ? "energy" : "price-l");
    axes.push({
      stroke: "#888",
      grid: { stroke: "rgba(0,0,0,0.06)" },
      font: "12px system-ui, sans-serif",
      scale,
      ...(hasPriceL && !hasPower ? { label: `${currencySymbol}/MWh` } : {}),
    });
  }

  // Secondary right axes
  if (hasPriceR) {
    axes.push({
      stroke: "#888",
      grid: { show: false },
      font: "12px system-ui, sans-serif",
      side: 1,
      scale: "price-r",
      label: `${currencySymbol}/MWh`,
    });
  }

  if (hasPercent) {
    axes.push({
      stroke: "#888",
      grid: { show: false },
      font: "12px system-ui, sans-serif",
      side: 1,
      scale: "percent",
      label: "%",
    });
  }

  const opts = {
    title,
    scales: {
      x: { time: true },
    },
    cursor: {
      show: true,
      lock: false,
      focus: { prox: 10 },
      y: false,
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

  return {
    opts,
    startTime,
    interval,
  };
}

// Re-export for backward compatibility during transition
export { buildUplotOpts as buildUplotPayload };
