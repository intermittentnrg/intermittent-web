export interface DashboardTabItem {
  key: string;
  label: string;
  chartLibrary?: string;
  features: string[];
}

export interface DashboardTabGroup {
  label: string;
  items: DashboardTabItem[];
}

export {
  dashboardTabGroups,
  dashboardHasFeature,
  dashboardChartLibrary,
  dashboardLabel,
  areaLabel,
  dashboardPageTitle,
} from "./dashboardCatalog.js";
