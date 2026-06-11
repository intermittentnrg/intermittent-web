import { formatPower, formatEnergy, formatPrice, formatMagnitude } from "./chart_formatters.ts";

export type CustomSeriesLabelFormatter = {
  type: string;
  template?: string;
};

export function processEchartsFormatters<T>(options: T): T {
  const processed = structuredClone(options) as Record<string, any>;

  function processChartOptions(obj: Record<string, any>) {
    for (const series of arrayOf(obj.series)) {
      processSeriesLabelFormatter(series?.label);
    }
  }

  // Handle timeline format (baseOption + options array)
  if (processed.baseOption) {
    processChartOptions(processed.baseOption);
    if (Array.isArray(processed.options)) {
      for (const frame of processed.options) {
        processChartOptions(frame);
      }
    }
  } else {
    processChartOptions(processed);
  }

  return processed as T;
}

export function processSeriesLabelFormatter(label: Record<string, any> | undefined) {
  const formatter = label?.formatter as CustomSeriesLabelFormatter | undefined;
  const type = formatter?.type;
  if (!label || !type) return;
  label.formatter = (params: any) => {
    // With dataset+encode, params.value is the full row [t, v1, v2, ...].
    // Extract the y-value via the encode mapping when present.
    const value = params.encode?.y?.length != null
      ? params.value[params.encode.y[0]]
      : params.value;
    if (type === "blank-invalid-template") return formatBlankInvalidTemplate(value, formatter.template);
    return value?.toString() || "-";
  };
}

function arrayOf<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function formatBlankInvalidTemplate(value: unknown, template: unknown) {
  const numericValue = Number(value);
  if (value === null || value === undefined || Number.isNaN(numericValue)) return "";
  return String(template || "{c}").replaceAll("{c}", numericValue.toFixed(0));
}

// Re-export shared formatters so existing ECharts importers still work.
export { formatPower, formatEnergy, formatPrice, formatMagnitude };
