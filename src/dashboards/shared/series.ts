import type { AnyRow, Series, TimeMetricValueRow } from "./types.js";

export function divergentSeries<T extends Series>(input: T[]): T[] {
  const output: T[] = [];
  for (const series of input) {
    let hasPositive = false;
    let hasNegative = false;

    for (const [, value] of series.data) {
      if (value > 0) hasPositive = true;
      if (value < 0) hasNegative = true;
      if (hasPositive && hasNegative) break;
    }

    if (hasPositive && hasNegative) {
      output.push({
        ...series,
        stack: "pos",
        data: series.data.map(([time, value]: [number, number]) => [time, Math.max(value, 0)]),
      });
      output.push({
        ...series,
        name: `${series.name}_negative`,
        stack: "neg",
        data: series.data.map(([time, value]: [number, number]) => [time, Math.min(value, 0)]),
      });
    } else {
      output.push({
        ...series,
        stack: hasNegative ? "neg" : "pos",
      });
    }
  }

  return output;
}

export function buildMinMaxSeries(rows: AnyRow[]): Series[] {
  return [
    {
      name: "Min",
      type: "line",
      stack: "confidence-band",
      symbol: "none",
      lineStyle: { width: 0 },
      data: rows.map((row) => [row.time, row.min_value]),
    },
    {
      name: "Max",
      type: "line",
      stack: "confidence-band",
      symbol: "none",
      lineStyle: { width: 0 },
      areaStyle: { color: "rgba(150, 150, 150, 0.3)" },
      data: rows.map((row) => [
        row.time,
        row.max_value - row.min_value,
      ]),
    },
    {
      name: "Average",
      type: "line",
      symbol: "none",
      lineStyle: { width: 2, color: "rgb(150, 150, 150)" },
      data: rows.map((row) => [row.time, row.avg_value]),
    },
  ];
}

export function buildYoySeries(rows: AnyRow[]): Series[] {
  const seriesByMetric = new Map<string, Series>();

  for (const row of rows) {
    const metric = String(row.metric);

    if (!seriesByMetric.has(metric)) {
      seriesByMetric.set(metric, {
        name: metric,
        type: "line",
        symbol: "none",
        lineStyle: { width: 2 },
        data: [],
      });
    }

    seriesByMetric
      .get(metric)!
      .data.push([
        row.time,
        row.value * 1000,
      ]);
  }

  return [...seriesByMetric.values()];
}

export function buildBasicSeries(
  rows: AnyRow[],
  type: "line" | "bar",
  stacked: boolean,
  unit: string,
  options: {
    areaColors?: boolean;
    colorForMetric?: (metric: string) => string | undefined;
    stackForMetric?: (
      metric: string,
      type: "line" | "bar",
    ) => string | undefined;
  } = {},
): Series[] {
  const byKey = new Map<string, Series>();

  for (const row of rows) {
    if (row.time == null) continue;

    const key = row.metric || "";
    if (!byKey.has(key)) {
      const isNegative = key.endsWith("_negative");
      byKey.set(key, {
        name: key,
        type,
        unit,
        stack: stacked
          ? (options.stackForMetric?.(key, type) ??
            (type === "bar" ? "all" : "total"))
          : undefined,
        symbol: type === "line" ? "none" : undefined,
        areaStyle: type === "line" && stacked ? { opacity: 0.75 } : undefined,
        lineStyle: type === "line" ? { width: stacked ? 0 : 2 } : undefined,
        itemStyle: options.colorForMetric
          ? { color: options.colorForMetric(key) }
          : undefined,
        data: [],
      });
    }

    byKey
      .get(key)!
      .data.push([
        row.time,
        row.value * (unit === "power" ? 1000 : 1),
      ]);
  }

  return [...byKey.values()];
}

export function buildPowerLineSeries(
  rows: TimeMetricValueRow[],
  colorForMetric?: (metric: string) => string | undefined,
) {
  return buildBasicSeries(rows, "line", true, "power", { colorForMetric });
}

export function buildStackedPowerLineSeries(rows: AnyRow[]) {
  return buildBasicSeries(rows, "line", true, "power", {
    stackForMetric: (metric) =>
      metric.endsWith("_negative") ? "negative" : "total",
  });
}

export function buildFieldSeries(
  rows: AnyRow[],
  field: string,
  unit: string,
  options: {
    nameField?: string;
    multiplier?: number;
    suffix?: string;
    yAxisIndex?: number;
    lineStyle?: Record<string, unknown>;
  } = {},
): Series[] {
  const nameField = options.nameField || "name";
  const multiplier = options.multiplier ?? 1;
  const suffix = options.suffix || "";
  const yAxisIndex = options.yAxisIndex || 0;
  const seriesByName = new Map<string, Series>();

  for (const row of rows) {
    const name = String(row[nameField]) + suffix;
    if (!seriesByName.has(name)) {
      seriesByName.set(name, {
        name,
        type: "line",
        unit,
        symbol: "none",
        lineStyle: options.lineStyle ?? { width: 2 },
        yAxisIndex,
        data: [],
      });
    }

    seriesByName
      .get(name)!
      .data.push([
        row.time,
        row[field] * multiplier,
      ]);
  }

  return [...seriesByName.values()];
}
