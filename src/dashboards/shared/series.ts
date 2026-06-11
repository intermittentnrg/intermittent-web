import { cyclePalette, yoyColor } from "./colors.ts";
import type { AnyRow, TimeMetricValueRow } from "./types.ts";
import type { UplotSeriesDesc } from "./uplotOptions.ts";

/** Convert an rgb() string to rgba() with the given opacity. */
function alphaColor(color: string | undefined, opacity: number): string | undefined {
  if (!color) return undefined;
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `,${opacity})`);
  return color;
}

// ── Generic helpers ──

type RowsToSeriesOptions<Row extends AnyRow> = {
  name?: keyof Row | ((row: Row) => string);
  x?: keyof Row | ((row: Row) => number);
  y?: keyof Row | ((row: Row) => number);
  type?: "line" | "bar" | "scatter";
  colorForMetric?: (metric: string) => string | undefined;
};

export function rowsToSeries<Row extends AnyRow>(
  rows: Row[],
  options: RowsToSeriesOptions<Row> = {},
): UplotSeriesDesc[] {
  const name = options.name ?? "metric";
  const x = options.x ?? "time";
  const y = options.y ?? "value";
  const colorFn = options.colorForMetric ?? cyclePalette();
  const byName = new Map<string, UplotSeriesDesc>();

  for (const row of rows) {
    const seriesName = String(valueFor(row, name));
    const yValue = Number(valueFor(row, y));

    if (!byName.has(seriesName)) {
      const color = colorFn(seriesName);
      const s: UplotSeriesDesc = {
        label: seriesName,
        data: [],
        stroke: color,
      };
      if (options.type && options.type !== "line") s.type = options.type;
      byName.set(seriesName, s);
    }

    byName.get(seriesName)!.data.push(yValue);
  }

  return [...byName.values()];
}

function valueFor<Row extends AnyRow, Value>(
  row: Row,
  field: keyof Row | ((row: Row) => Value),
): Value | Row[keyof Row] {
  return typeof field === "function" ? field(row) : row[field];
}

// Re-export divergentSeries from the shared .js module so it works in both
// backend (TypeScript via Node.js) and browser (esbuild bundle).
export { divergentSeries } from "../../shared/series.js";

// ── Min / Max / Average (confidence band) ──

export function buildMinMaxSeries(rows: AnyRow[]): UplotSeriesDesc[] {
  return [
    {
      label: "Min",
      width: 0,
      stroke: "rgba(150, 150, 150, 0.01)",
      stack: "confidence-band",
      data: rows.map((row) => row.min_value as number),
    },
    {
      label: "Max",
      width: 0,
      stroke: "rgba(150, 150, 150, 0.3)",
      fill: "rgba(150, 150, 150, 0.3)",
      stack: "confidence-band",
      data: rows.map((row) => (row.max_value as number) - (row.min_value as number)),
    },
    {
      label: "Average",
      width: 2,
      stroke: "rgb(150, 150, 150)",
      data: rows.map((row) => row.avg_value as number),
    },
  ];
}

// ── Year-over-Year ──

export function buildYoySeries(rows: AnyRow[]): UplotSeriesDesc[] {
  const byMetric = new Map<string, UplotSeriesDesc>();

  for (const row of rows) {
    const metric = String(row.metric);
    if (!byMetric.has(metric)) {
      byMetric.set(metric, {
        label: metric,
        width: 2,
        data: [],
      });
    }
    byMetric.get(metric)!.data.push(row.value as number);
  }

  const series = [...byMetric.values()];
  const years = series
    .map((s) => Number(s.label))
    .filter((y) => !isNaN(y))
    .sort((a, b) => a - b);

  if (years.length > 0) {
    const minYear = years[0];
    const maxYear = years[years.length - 1];
    const yearRange = maxYear - minYear;

    for (const s of series) {
      const year = Number(s.label);
      if (isNaN(year)) continue;
      const t = yearRange > 0 ? (year - minYear) / yearRange : 1;
      s.stroke = yoyColor(t);
      s.width = year === maxYear ? 3 : 2;
    }
  }

  return series;
}

// ── Basic series (line / bar, stacked or not) ──

export function buildBasicSeries(
  rows: AnyRow[],
  type: "line" | "bar",
  stacked: boolean,
  _unit: string,
  options: {
    areaColors?: boolean;
    colorForMetric?: (metric: string) => string | undefined;
    stackForMetric?: (
      metric: string,
      type: "line" | "bar",
    ) => string | undefined;
  } = {},
): UplotSeriesDesc[] {
  const colorFn = options.colorForMetric ?? cyclePalette();
  const byKey = new Map<string, UplotSeriesDesc>();

  for (const row of rows) {
    if (row.time == null) continue;

    const key = row.metric || "";
    if (!byKey.has(key)) {
      const color = colorFn(key);
      byKey.set(key, {
        label: key,
        data: [],
        stroke: color,
        width: type === "bar" ? 0 : (stacked ? 0 : 2),
        fill: stacked ? alphaColor(color, 0.75) : undefined,
        stack: stacked
          ? (options.stackForMetric?.(key, type) ??
            (type === "bar" ? "all" : "total"))
          : undefined,
        ...(type !== "line" ? { type } : {}),
      });
    }

    byKey.get(key)!.data.push(row.value as number);
  }

  return [...byKey.values()];
}

export function buildPowerLineSeries(
  rows: TimeMetricValueRow[],
  colorForMetric?: (metric: string) => string | undefined,
): UplotSeriesDesc[] {
  return buildBasicSeries(rows, "line", true, "power", { colorForMetric });
}

export function buildStackedPowerLineSeries(rows: AnyRow[]): UplotSeriesDesc[] {
  return buildBasicSeries(rows, "line", true, "power", {
    stackForMetric: (metric) =>
      metric.endsWith("_negative") ? "negative" : "total",
  });
}

// ── Field-based series (for perUnit moving capacity) ──

export function buildFieldSeries(
  rows: AnyRow[],
  field: string,
  _unit: string,
  options: {
    nameField?: string;
    suffix?: string;
    scale?: string;
    lineStyle?: { width?: number; type?: string };
    colorForMetric?: (metric: string) => string | undefined;
  } = {},
): UplotSeriesDesc[] {
  const nameField = options.nameField || "name";
  const suffix = options.suffix || "";
  const colorFn = options.colorForMetric ?? cyclePalette();
  const seriesByName = new Map<string, UplotSeriesDesc>();

  for (const row of rows) {
    const name = String(row[nameField]) + suffix;
    if (!seriesByName.has(name)) {
      const color = colorFn(name);
      const ls = options.lineStyle ?? { width: 2 };
      seriesByName.set(name, {
        label: name,
        data: [],
        stroke: color,
        width: ls.width ?? 2,
        scale: options.scale,
        dash: ls.type === "dashed" ? [6, 3] : undefined,
      });
    }

    seriesByName.get(name)!.data.push(row[field] as number);
  }

  return [...seriesByName.values()];
}
