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
 * Build uPlot-compatible options and data from series data.
 *
 * Stacking strategy:
 * 1. Group series by their `stack` property
 * 2. Within each group, accumulate values (running total)
 * 3. Add bands between consecutive cumulative series
 * 4. First series in a group fills from its values down to 0 (scale min)
 * 5. Non-stacked series (prices on secondary axis) are rendered as bare lines
 *
 * @param title - Chart title
 * @param timestamps - Array of Unix-epoch-second timestamps (for x-axis)
 * @param series - Array of series descriptors, each with label, data, stroke, fill, stack, etc.
 * @returns uPlot-compatible options and data
 */
export function buildUplotPayload(title, timestamps, series, currencySymbol = "€") {
  const length = timestamps.length;
  const startTime = length > 0 ? timestamps[0] : 0;
  const interval = length > 1 ? timestamps[1] - timestamps[0] : 0;

  // Data columns: value series only (timestamps derived from startTime + interval * index)
  const data = [];
  const rawData = [];
  const uplotSeries = [{ label: "Time" }];
  const bands = [];
  const seriesMeta = [];

  // Separate series into stack groups and non-stacked
  const stackGroups = new Map();
  const nonStacked = [];

  for (const s of series) {
    if (s.stack) {
      if (!stackGroups.has(s.stack)) stackGroups.set(s.stack, []);
      stackGroups.get(s.stack).push(s);
    } else {
      nonStacked.push(s);
    }
  }

  // Process each stack group
  for (const [_groupName, groupSeries] of stackGroups) {
    // If the first series in the group has negative values, the band
    // clip direction must extend downward from the reference series
    // instead of upward (uPlot default). See clipBandLine in the bundle.
    // Check ALL series in the group, not just the first — the first
    // series may have zeros (from divergentSeries split) while later
    // ones carry the actual negative values.
    const isNegGroup = groupSeries.some(s => s.data?.some(v => v != null && v < 0)) ?? false;
    const accum = new Array(length).fill(0);

    for (let gi = 0; gi < groupSeries.length; gi++) {
      const s = groupSeries[gi];
      const raw = padTo(s.data, length);

      // Cumulative (for rendering)
      const cumCol = [];
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
      const uS = {
        label: s.label,
        stroke: s.stroke,
        width: s.width ?? 1,
        points: { show: false },
      };

      // Map scale names: % → percent, others pass through
      if (s.scale) uS.scale = s.scale;

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
      //
      // For negative-value groups the band clip must extend downward
      // from the reference series (dir: 1) instead of upward (default).
      if (!isFirstInGroup && s.fill) {
        bands.push({
          series: [colIdx + 1, colIdx],
          fill: s.fill,
          ...(isNegGroup ? { dir: 1 } : {}),
        });
      }
    }
  }

  // Non-stacked series
  for (const s of nonStacked) {
    const vals = padTo(s.data, length);
    data.push(vals);
    rawData.push(vals);

    const uS = {
      label: s.label,
      stroke: s.stroke,
      width: s.width ?? 1,
      points: { show: false },
    };

    if (s.scale) uS.scale = s.scale;
    if (s.fill) uS.fill = s.fill;

    uplotSeries.push(uS);
    seriesMeta.push({ type: s.type });
  }

  // Determine which axes are needed
  const hasPower = series.some((s) => !s.scale || s.scale === "y" || s.scale === "power");
  const hasPriceL = series.some((s) => s.scale === "price-l");
  const hasPriceR = series.some((s) => s.scale === "price-r");
  const hasPercent = series.some((s) => s.scale === "percent");
  const hasEnergy = series.some((s) => s.scale === "energy");

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
    data,
    rawData,
    seriesMeta,
    startTime,
    interval,
  };
}
