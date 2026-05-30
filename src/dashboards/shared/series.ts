import { yoyColor } from "./colors.ts";
import type { AnyRow, Series, TimeMetricValueRow } from "./types.ts";

type RowsToSeriesOptions<Row extends AnyRow> = {
  name?: keyof Row | ((row: Row) => string);
  x?: keyof Row | ((row: Row) => number);
  y?: keyof Row | ((row: Row) => number);
  type?: Series["type"];
  unit?: string;
};

export function rowsToSeries<Row extends AnyRow>(
  rows: Row[],
  options: RowsToSeriesOptions<Row> = {},
): Series[] {
  const name = options.name ?? "metric";
  const x = options.x ?? "time";
  const y = options.y ?? "value";
  const type = options.type ?? "line";
  const byName = new Map<string, Series>();

  for (const row of rows) {
    const seriesName = String(valueFor(row, name));
    const xValue = Number(valueFor(row, x));
    const yValue = Number(valueFor(row, y));

    if (!byName.has(seriesName)) {
      byName.set(seriesName, {
        name: seriesName,
        type,
        unit: options.unit,
        data: [],
      });
    }

    byName.get(seriesName)!.data.push([xValue, yValue]);
  }

  return [...byName.values()];
}

function valueFor<Row extends AnyRow, Value>(
  row: Row,
  field: keyof Row | ((row: Row) => Value),
): Value | Row[keyof Row] {
  return typeof field === "function" ? field(row) : row[field];
}

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

  // Assign gray ramp colors sorted by year, current year gets thicker line
  const series = [...seriesByMetric.values()];
  const years = series
    .map((s) => Number(s.name))
    .filter((y) => !isNaN(y))
    .sort((a, b) => a - b);

  if (years.length > 0) {
    const minYear = years[0];
    const maxYear = years[years.length - 1];
    const yearRange = maxYear - minYear;

    for (const s of series) {
      const year = Number(s.name);
      if (isNaN(year)) continue;
      const t = yearRange > 0 ? (year - minYear) / yearRange : 1;
      const color = yoyColor(t);
      const width = year === maxYear ? 3 : 2;
      s.lineStyle = { ...(s.lineStyle as object), color, width };
      s.itemStyle = { color };
    }
  }

  return series;
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
