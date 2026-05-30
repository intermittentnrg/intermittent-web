export type CustomSeriesLabelFormatter = {
  type: string;
  template?: string;
};

export function processEchartsFormatters<T>(options: T): T {
  const processed = structuredClone(options) as Record<string, any>;

  // Process a single chart options object (not timeline format)
  function processChartOptions(obj: Record<string, any>) {
    for (const axis of arrayOf(obj.yAxis)) {
      const formatter = axis?.axisLabel?.formatter;
      if (typeof formatter === "object" && formatter !== null && "type" in formatter) {
        axis.axisLabel.formatter = formatterForType(formatter.type);
      } else if (typeof formatter === "object" && formatter !== null && "unit" in formatter) {
        axis.axisLabel.formatter = formatterForUnit(formatter.unit);
      }
    }

    for (const axis of arrayOf(obj.xAxis)) {
      if (axis?.axisLabel?.formatter?.type === "date") {
        axis.axisLabel.formatter = formatterForType("date");
      }
    }

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

function processSeriesLabelFormatter(label: Record<string, any> | undefined) {
  const formatter = label?.formatter as CustomSeriesLabelFormatter | undefined;
  const type = formatter?.type;
  if (!label || !type) return;
  label.formatter = (params: { value: unknown }) => {
    if (type === "blank-invalid-template") return formatBlankInvalidTemplate(params.value, formatter.template);
    return formatByType(params.value, type);
  };
}

function arrayOf<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function formatterForType(type: unknown) {
  if (type === "power") return (value: unknown) => formatPower(value);
  if (type === "energy") return (value: unknown) => formatEnergy(value);
  if (type === "price") return (value: unknown) => formatPrice(value);
  if (type === "date") return (value: unknown) => {
    const date = new Date(value as string | number | Date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };
  return (value: unknown) => value?.toString() || "-";
}

export function formatterForUnit(unit: unknown) {
  const unitString = String(unit);
  if (unitString.includes("€/MWh") || unitString.includes("€")) return (value: unknown) => formatPrice(value);
  if (unitString.includes("Wh")) return (value: unknown) => formatEnergy(value);
  if (unitString.includes("W")) return (value: unknown) => formatPower(value);
  return (value: unknown) => Number(value).toFixed(0);
}

export function formatByType(value: unknown, type: unknown) {
  if (type === "energy") return formatEnergy(value);
  if (type === "power") return formatPower(value);
  if (type === "price") return formatPrice(value);
  return value?.toString() || "-";
}

export function formatBlankInvalidTemplate(value: unknown, template: unknown) {
  const numericValue = Number(value);
  if (value === null || value === undefined || Number.isNaN(numericValue)) return "";
  return String(template || "{c}").replaceAll("{c}", numericValue.toFixed(0));
}

export function formatPower(value: unknown) {
  return formatMagnitude(value, ["W", "kW", "MW", "GW", "TW"]);
}

export function formatEnergy(value: unknown) {
  return formatMagnitude(value, ["Wh", "kWh", "MWh", "GWh", "TWh"]);
}

export function formatMagnitude(value: unknown, suffixes: string[]) {
  const numericValue = Number(value);
  if (value === null || value === undefined || Number.isNaN(numericValue)) return "-";

  const absValue = Math.abs(numericValue);
  for (let i = suffixes.length - 1; i >= 0; i--) {
    const threshold = 1000 ** i;
    if (absValue >= threshold) {
      return `${(numericValue / threshold).toFixed(0)}${suffixes[i]}`;
    }
  }
  return `${numericValue.toFixed(0)}${suffixes[0]}`;
}

export function formatPrice(value: unknown) {
  const numericValue = Number(value);
  if (value === null || value === undefined || Number.isNaN(numericValue)) return "-";
  return `${numericValue.toFixed(0)}€/MWh`;
}
