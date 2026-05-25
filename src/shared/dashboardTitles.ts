import { titleize } from "../dashboards/shared/text.ts";

const dashboardLabels: Record<string, string> = {
  electricity_mix: "Electricity Mix",
  generation: "Generation",
  generation_min_max: "Min/Max",
  generation_total: "Total",
  generation_yoy: "YoY",
  capture_price: "Capture Price",
  simulation: "Simulation",
  per_unit: "Per Unit",
  per_unit_peak: "Heatmap",
  per_unit_total: "Total",
  per_unit_moving_capacity: "Moving Capacity",
  per_unit_battery: "Battery",
  demand: "Demand",
  demand_min_max: "Min/Max",
  demand_yoy: "YoY",
  transmission: "Transmission",
  prices: "Prices",
  price_map: "Price Map",
  generation_of_peak_map: "Generation of Peak Map",
};

export function dashboardLabel(dashboardType: string) {
  return dashboardLabels[dashboardType] || titleize(dashboardType);
}

export function areaLabel(region: string, area: string) {
  const regionLabel = titleize(region);
  const areaLabel = area === "all" ? "All areas" : area;
  return `${regionLabel} • ${areaLabel}`;
}

export function dashboardPageTitle(dashboardType: string, region: string, area: string) {
  return `${dashboardLabel(dashboardType)} • ${areaLabel(region, area)}`;
}
