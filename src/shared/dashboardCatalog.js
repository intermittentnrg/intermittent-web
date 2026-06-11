/**
 * Runtime source of truth for dashboard tab navigation, labels, and features.
 * Shared between server (imported via dashboardCatalog.ts) and
 * client (imported directly in dev mode, bundled in production).
 */

export const dashboardTabGroups = [
  {
    label: "Electricity Mix",
    items: [
      { key: "electricity_mix", label: "Electricity Mix", chartLibrary: "uplot", features: ["prices_checkbox", "load_checkbox", "transmission_checkbox", "production_type_group_selector"] },
      { key: "simulation", label: "Simulation", chartLibrary: "uplot", features: ["production_type_selector", "transmission_checkbox", "simulation_multipliers"] },
    ],
  },
  {
    label: "Generation",
    items: [
      { key: "generation", label: "Generation", chartLibrary: "uplot", features: ["production_type_selector", "prices_checkbox", "temps_checkbox", "load_checkbox", "transmission_checkbox"] },
      { key: "generation_min_max", label: "Min/Max", chartLibrary: "uplot", features: ["production_type_selector"] },
      { key: "generation_total", label: "Total", chartLibrary: "uplot", features: ["production_type_selector"] },
      { key: "generation_yoy", label: "YoY", chartLibrary: "uplot", features: ["production_type_selector"] },
    ],
  },
  {
    label: "Demand",
    items: [
      { key: "demand", label: "Demand", chartLibrary: "uplot", features: [] },
      { key: "demand_min_max", label: "Min/Max", chartLibrary: "uplot", features: [] },
      { key: "demand_yoy", label: "YoY", chartLibrary: "uplot", features: [] },
    ],
  },
  {
    label: "Transmission",
    items: [
      { key: "transmission", label: "Transmission", chartLibrary: "uplot", features: ["transmission_selector"] },
    ],
  },
  {
    label: "Per Unit",
    items: [
      { key: "per_unit", label: "Per Unit", chartLibrary: "uplot", features: ["production_type_selector", "per_unit_selector"] },
      { key: "per_unit_peak", label: "Heatmap", chartLibrary: "uplot", features: ["production_type_selector", "per_unit_selector"] },
      { key: "per_unit_total", label: "Total", chartLibrary: "uplot", features: ["production_type_selector", "per_unit_selector"] },
      { key: "per_unit_moving_capacity", label: "Moving Capacity", chartLibrary: "uplot", features: ["production_type_selector", "per_unit_selector"] },
      { key: "per_unit_battery", label: "Battery", chartLibrary: "uplot", features: ["production_type_selector", "per_unit_selector"] },
    ],
  },
  {
    label: "Prices",
    items: [
      { key: "prices", label: "Prices", chartLibrary: "uplot", features: [] },
      { key: "capture_price", label: "Capture Price", chartLibrary: "uplot", features: ["production_type_selector"] },
      { key: "price_map", label: "Price Map", features: [] },
    ],
  },
];

// Build flat feature lookup from the groups.
const featuresByKey = {};
for (const group of dashboardTabGroups) {
  for (const item of group.items) {
    featuresByKey[item.key] = item.features || [];
  }
}

// Extra features for dashboards that exist as pages but aren't in the nav.
featuresByKey.sweden = ["prices_checkbox", "load_checkbox", "transmission_checkbox"];
featuresByKey.generation_of_peak_map = [];

// Chart library lookup
const chartLibraryByKey = {};
for (const group of dashboardTabGroups) {
  for (const item of group.items) {
    chartLibraryByKey[item.key] = item.chartLibrary || "echarts";
  }
}
chartLibraryByKey.sweden = "uplot";
chartLibraryByKey.generation_of_peak_map = "echarts";

export function dashboardChartLibrary(dashboardType) {
  return chartLibraryByKey[dashboardType] || "echarts";
}

export function dashboardHasFeature(dashboardType, feature) {
  const feats = featuresByKey[dashboardType];
  return feats ? feats.includes(feature) : false;
}

// Build flat label lookup from the groups.
const labelsByKey = {};
for (const group of dashboardTabGroups) {
  for (const item of group.items) {
    labelsByKey[item.key] = item.label;
  }
}

labelsByKey.generation_of_peak_map = "Generation of Peak Map";

function capitalize(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function dashboardLabel(dashboardType) {
  return labelsByKey[dashboardType];
}

export function areaLabel(region, area) {
  const regionLabel = capitalize(region);
  const areaLabel = area === "all" ? "All areas" : area;
  return `${regionLabel} • ${areaLabel}`;
}

export function dashboardPageTitle(dashboardType, region, area) {
  return `${dashboardLabel(dashboardType)} • ${areaLabel(region, area)}`;
}
