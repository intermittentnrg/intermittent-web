import type {
  BarSeriesOption,
  HeatmapSeriesOption,
  LineSeriesOption,
  MapSeriesOption,
  ScatterSeriesOption,
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
  resolution?: string;
  min_resolution?: string;
  production_type?: string;
  transmission?: string;
  units?: string;
  prices?: string;
  load?: string;
  nuclear_multiplier?: string;
  wind_multiplier?: string;
  solar_multiplier?: string;
  demand_multiplier?: string;
  colors?: string;
  production_type_groups?: string;
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
  | MapSeriesOption
  | ScatterSeriesOption;

export type Series = BuiltInSeriesOption & {
  name: string;
  data: number[];
  /** Application metadata consumed by frontend formatters. */
  unit?: string;
};
