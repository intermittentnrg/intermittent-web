import type { Series } from "./types.ts";

export function buildChartOptions(
  series: Series[],
  title: string,
  formatterType: string,
  showLegend = true,
) {
  return {
    useUTC: true,
    title: { text: title, left: "center", top: 10 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      confine: true,
      formatter: { type: formatterType },
    },
    legend: showLegend
      ? {
          orient: "horizontal",
          top: "86%",
          data: [...new Set(series.map((s) => s.name))],
        }
      : undefined,
    grid: {
      left: 0,
      right: 0,
      bottom: 100,
      top: 55,
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
            axisLabel: secondaryFormatter ? { formatter: secondaryFormatter, lineHeight: 16 } : {},
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
      confine: true,
      formatter: { type: "multi" },
    },
    legend: {
      orient: "horizontal",
      top: "86%",
      data: [...new Set(series.map((s) => s.name))],
    },
    grid: {
      left: 0,
      right: hasSecondary ? 60 : 0,
      bottom: 100,
      top: 55,
    },
    xAxis: { type: "time", boundaryGap: false },
    yAxis: yAxis.map((axis, i) => {
      if (i === 1 && hasSecondary) {
        return { ...axis, name: "€/MWh", nameLocation: "end", nameGap: 10, nameTextStyle: { align: "left" } };
      }
      return axis;
    }),
    series,
  };
}
