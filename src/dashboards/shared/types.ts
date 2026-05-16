import type {
  BarSeriesOption,
  HeatmapSeriesOption,
  LineSeriesOption,
  MapSeriesOption,
} from "echarts/types/dist/charts";

export type DashboardParams = {
  region: string;
  area_type: string;
  area: string;
  date_range: string;
  dashboard?: string;
};

export type AreaRow = {
  region: string;
  type: string;
  code: string;
  source: string;
};

export type DashboardQuery = {
  width?: string;
  min_interval?: string;
  production_type?: string;
  transmission?: string;
  units?: string;
  prices?: string;
  nuclear_multiplier?: string;
  wind_multiplier?: string;
  solar_multiplier?: string;
  demand_multiplier?: string;
};

export type AnyRow = Record<string, any>;

export type TimeMetricValueRow = {
  time: number;
  metric: string;
  value: number;
};

type BuiltInSeriesOption =
  | LineSeriesOption
  | BarSeriesOption
  | HeatmapSeriesOption
  | MapSeriesOption;

export type Series = BuiltInSeriesOption & {
  name: string;
  data: Array<[number, number]>;
  // Application metadata consumed by frontend formatters.
  unit?: string;
};
