import type { Series } from "./types.ts";

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
      orient: "horizontal",
      bottom: 0,
      data: [...new Set(series.map((s) => s.name))],
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: 100,
      top: 55,
      outerBoundsMode: "same",
      outerBoundsContain: "axisLabel",
    },
    xAxis: { type: "time", boundaryGap: false },
    yAxis: { type: "value", axisLabel: { formatter: { type: formatterType } } },
    series,
  };
}

export function buildDualAxisOptions(
  series: Array<{ name: string; unit?: string; yAxisIndex?: number }>,
  title: string,
) {
  const secondarySeries = series.filter((s) => s.yAxisIndex === 1);
  const hasSecondary = secondarySeries.length > 0;
  const priceSeries = secondarySeries.some((s) => s.unit === "price" || s.name?.includes("price"));
  const tempSeries = secondarySeries.some((s) => s.unit === "temperature" || s.name?.includes("temp"));
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
      orient: "horizontal",
      bottom: 0,
      data: [...new Set(series.map((s) => s.name))],
    },
    grid: {
      left: "3%",
      right: hasSecondary ? "6%" : "4%",
      bottom: 100,
      top: 55,
      outerBoundsMode: "same",
      outerBoundsContain: "axisLabel",
    },
    xAxis: { type: "time", boundaryGap: false },
    yAxis,
    series,
  };
}
