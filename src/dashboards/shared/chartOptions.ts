import type { Series } from "./types.js";

export function buildChartOptions(
  series: Series[],
  title: string,
  formatterType: string,
) {
  return {
    useUTC: true,
    title: { text: title, left: "center", top: 10 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: { type: formatterType },
    },
    legend: {
      type: "scroll",
      orient: "horizontal",
      top: 40,
      data: [...new Set(series.map((s) => s.name))],
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "18%",
      containLabel: true,
    },
    xAxis: { type: "time", boundaryGap: false },
    yAxis: { type: "value", axisLabel: { formatter: { type: formatterType } } },
    series,
  };
}

export function buildDualAxisOptions(
  series: Array<{ name: string; yAxisIndex?: number }>,
  title: string,
) {
  const hasSecondary = series.some((s) => s.yAxisIndex === 1);
  const priceSeries = series.some((s) => s.name?.includes("price"));
  const tempSeries = series.some((s) => s.name?.includes("temp"));
  const secondaryFormatter = priceSeries
    ? { type: "price" }
    : tempSeries
      ? { unit: "°C" }
      : undefined;
  const yAxis = [
    { type: "value", axisLabel: { formatter: { type: "power" } } },
    ...(hasSecondary
      ? [
          {
            type: "value",
            position: "right",
            axisLabel: secondaryFormatter
              ? { formatter: secondaryFormatter }
              : {},
          },
        ]
      : []),
  ];

  return {
    useUTC: true,
    title: { text: title, left: "center", top: 10 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: { type: "multi" },
    },
    legend: {
      type: "scroll",
      orient: "horizontal",
      top: 40,
      data: [...new Set(series.map((s) => s.name))],
    },
    grid: {
      left: "3%",
      right: hasSecondary ? "6%" : "4%",
      bottom: "3%",
      top: "18%",
      containLabel: true,
    },
    xAxis: { type: "time", boundaryGap: false },
    yAxis,
    series,
  };
}
