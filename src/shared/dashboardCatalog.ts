export interface DashboardTabItem {
  key: string;
  label: string;
  features: string[];
}

export interface DashboardTabGroup {
  label: string;
  items: DashboardTabItem[];
}

export {
  dashboardTabGroups,
  dashboardHasFeature,
  dashboardLabel,
  areaLabel,
  dashboardPageTitle,
} from "./dashboardCatalog.js";
