export type DashboardParams = {
  region: string;
  area_type: string;
  area: string;
  date_range: string;
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

export type Series = {
  name: string;
  type: "line" | "bar" | string;
  unit?: string;
  stack?: string;
  symbol?: string;
  yAxisIndex?: number;
  areaStyle?: Record<string, unknown>;
  lineStyle?: Record<string, unknown>;
  itemStyle?: Record<string, unknown>;
  data: Array<[number, number]>;
  [key: string]: unknown;
};
