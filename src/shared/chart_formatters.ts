/**
 * Shared chart formatters used by both uPlot and ECharts.
 */

export function formatPower(value: unknown): string {
  return formatMagnitude(value, ["kW", "MW", "GW", "TW"]);
}

export function formatEnergy(value: unknown): string {
  return formatMagnitude(value, ["kWh", "MWh", "GWh", "TWh"]);
}

export function formatMagnitude(value: unknown, suffixes: string[]): string {
  const numericValue = Number(value);
  if (value === null || value === undefined || Number.isNaN(numericValue)) return "-";

  const absValue = Math.abs(numericValue);
  for (let i = suffixes.length - 1; i >= 0; i--) {
    const threshold = 1000 ** i;
    if (absValue >= threshold) {
      const scaled = numericValue / threshold;
      // Show one decimal for values < 10 in the chosen unit (e.g. "1.5GW"),
      // otherwise use integer (e.g. "500MW", "100GW") for compact labels.
      if (Math.abs(scaled) < 10) {
        return `${Number(scaled.toFixed(1))}${suffixes[i]}`;
      }
      return `${Math.round(scaled)}${suffixes[i]}`;
    }
  }
  const scaled = numericValue;
  if (Math.abs(scaled) < 10) {
    return `${Number(scaled.toFixed(1))}${suffixes[0]}`;
  }
  return `${Math.round(scaled)}${suffixes[0]}`;
}

export function formatPrice(value: unknown): string {
  const numericValue = Number(value);
  if (value === null || value === undefined || Number.isNaN(numericValue)) return "-";
  return numericValue.toFixed(0);
}
