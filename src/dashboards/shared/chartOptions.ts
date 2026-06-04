import type { Series } from "./types.ts";

/**
 * Build an array of epoch-ms timestamps from startTime, interval, and data length.
 */
export function buildXAxisTimestamps(startTime: number, interval: number, length: number): number[] {
  const timestamps: number[] = [];
  for (let i = 0; i < length; i++) {
    timestamps.push(startTime + i * interval);
  }
  return timestamps;
}

/**
 * If the options object has top-level startTime/interval, build a 2D dataset table
 * (column 0 = timestamps, columns 1..N = series values) and wire each series to it
 * via encode.  The xAxis is switched to type "time" so ECharts picks nice intervals
 * (midnight, etc.) instead of repeating labels at every data-point position.
 *
 * Also called from the PNG-rendering path where formatters are already functions;
 * the options.dataset guard makes this idempotent so it's safe to call twice.
 */
export function applyTimeAxis(options: Record<string, any>): Record<string, any> {
  if (options.dataset) return options; // already applied
  const { startTime, interval, series, xAxis } = options;
  if (startTime == null || interval == null || !Array.isArray(series)) return options;
  const length = series.reduce<number>((max, s: any) => Math.max(max, s.data?.length ?? 0), 0);
  if (length === 0) return options;

  // Build 2D dataset table
  const timestamps = buildXAxisTimestamps(startTime, interval, length);
  const source: unknown[][] = [];
  for (let i = 0; i < length; i++) {
    const row: unknown[] = [timestamps[i]];
    for (const s of series) row.push(s.data?.[i] ?? null);
    source.push(row);
  }

  // Wire series to dataset via encode, drop raw data arrays
  const newSeries = series.map((s: any, idx: number) => {
    const { data: _drop, ...rest } = s;
    return { ...rest, encode: { x: 0, y: idx + 1 } };
  });

  // Time axis — ECharts picks natural label intervals
  const newXAxis = (Array.isArray(xAxis) ? xAxis : [xAxis]).map((ax: any) => {
    const { data: _drop, ...rest } = ax;
    return { ...rest, type: "time" };
  });

  return {
    ...options,
    dataset: { source },
    xAxis: Array.isArray(xAxis) ? newXAxis : newXAxis[0],
    series: newSeries,
  };
}

export function buildChartOptions(
  series: Series[],
  title: string,
  formatterType: string,
  showLegend = true,
  startTime?: number,
  interval?: number,
) {
  const options = {
    useUTC: true,
    title: { text: title, left: "center", top: 10 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      confine: true,
      formatter: { type: formatterType },
    },
    legend: showLegend
      ? {
          orient: "horizontal",
          top: "86%",
          data: [...new Set(series.map((s) => s.name))],
        }
      : undefined,
    grid: {
      left: 0,
      right: 0,
      bottom: 100,
      top: 55,
    },
    xAxis: { type: "category", boundaryGap: false },
    yAxis: { type: "value", axisLabel: { formatter: { type: formatterType }, hideOverlap: true } },
    series,
    startTime,
    interval,
  };
  return applyTimeAxis(options);
}

export function buildDualAxisOptions(
  series: Array<{ name: string; unit?: string; yAxisIndex?: number }>,
  title: string,
  startTime?: number,
  interval?: number,
) {
  const secondarySeries = series.filter((s) => s.yAxisIndex === 1);
  const hasSecondary = secondarySeries.length > 0;
  const priceSeries = secondarySeries.some((s) => s.unit === "price" || s.name?.includes("price"));
  const tempSeries = secondarySeries.some((s) => s.unit === "temperature" || s.name?.includes("temp"));
  const secondaryFormatter = priceSeries
    ? { type: "price" }
    : tempSeries
      ? { unit: "°C" }
      : undefined;
  const yAxis = [
    { type: "value", axisLabel: { formatter: { type: "power" }, hideOverlap: true } },
    ...(hasSecondary
      ? [
          {
            type: "value",
            position: "right",
            axisLabel: secondaryFormatter ? { formatter: secondaryFormatter, lineHeight: 16 } : {},
          },
        ]
      : []),
  ];

  const options = {
    useUTC: true,
    title: { text: title, left: "center", top: 10 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      confine: true,
      formatter: { type: "multi" },
    },
    legend: {
      orient: "horizontal",
      top: "86%",
      data: [...new Set(series.map((s) => s.name))],
    },
    grid: {
      left: 0,
      right: hasSecondary ? 60 : 0,
      bottom: 100,
      top: 55,
    },
    xAxis: { type: "category", boundaryGap: false },
    yAxis: yAxis.map((axis, i) => {
      if (i === 1 && hasSecondary) {
        return { ...axis, name: "€/MWh", nameLocation: "end", nameGap: 10, nameTextStyle: { align: "left" } };
      }
      return axis;
    }),
    series,
    startTime,
    interval,
  };
  return applyTimeAxis(options);
}
