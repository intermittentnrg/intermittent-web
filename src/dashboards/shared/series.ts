import type { AnyRow, TimeMetricValueRow } from "./types.js";

export function buildMinMaxSeries(rows: AnyRow[]) {
  return [
    {
      name: "Min",
      type: "line",
      stack: "confidence-band",
      symbol: "none",
      lineStyle: { width: 0 },
      data: rows.map((row) => [Number(row.time), Number(row.min_value)]),
    },
    {
      name: "Max",
      type: "line",
      stack: "confidence-band",
      symbol: "none",
      lineStyle: { width: 0 },
      areaStyle: { color: "rgba(150, 150, 150, 0.3)" },
      data: rows.map((row) => [
        Number(row.time),
        Number(row.max_value) - Number(row.min_value),
      ]),
    },
    {
      name: "Average",
      type: "line",
      symbol: "none",
      lineStyle: { width: 2, color: "rgb(150, 150, 150)" },
      data: rows.map((row) => [Number(row.time), Number(row.avg_value)]),
    },
  ];
}

export function buildYoySeries(rows: AnyRow[]) {
  const seriesByMetric = new Map<string, any>();

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
      .get(metric)
      .data.push([
        Number(row.time),
        row.value == null ? null : Number(row.value) * 1000,
      ]);
  }

  return [...seriesByMetric.values()];
}

export type BasicSeriesRow = TimeMetricValueRow;

export type BasicSeries = {
  name: string;
  type: "line" | "bar";
  unit?: string;
  stack?: string;
  symbol?: string;
  areaStyle?: { opacity: number };
  lineStyle?: Record<string, unknown>;
  itemStyle?: Record<string, unknown>;
  data: Array<[number, number | null]>;
};

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
): BasicSeries[] {
  const byKey = new Map<string, BasicSeries>();

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
            (type === "bar" ? (isNegative ? "negative" : "positive") : "total"))
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
        Number(row.time),
        row.value == null
          ? null
          : Number(row.value) * (unit === "power" ? 1000 : 1),
      ]);
  }

  return [...byKey.values()];
}

export function buildPowerLineSeries(
  rows: BasicSeriesRow[],
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
) {
  const nameField = options.nameField || "name";
  const multiplier = options.multiplier ?? 1;
  const suffix = options.suffix || "";
  const yAxisIndex = options.yAxisIndex || 0;
  const seriesByName = new Map<string, any>();

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
      .get(name)
      .data.push([
        Number(row.time),
        row[field] == null ? null : Number(row[field]) * multiplier,
      ]);
  }

  return [...seriesByName.values()];
}
