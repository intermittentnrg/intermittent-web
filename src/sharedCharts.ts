import { querySmall } from "./lib/db.js";

export type Series = { name: string; type: string; unit?: string; yAxisIndex?: number; data?: any[]; [key: string]: any };

export function buildChartOptions(series: Series[], title: string, formatterType: string) {
  return {
    useUTC: true,
    title: { text: title, left: "center", top: 10 },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" }, formatter: { type: formatterType } },
    legend: { type: "scroll", orient: "horizontal", top: 40, data: [...new Set(series.map((s) => s.name))] },
    grid: { left: "3%", right: "4%", bottom: "3%", top: "18%", containLabel: true },
    xAxis: { type: "time", boundaryGap: false },
    yAxis: { type: "value", axisLabel: { formatter: { type: formatterType } } },
    series,
  };
}

export async function getProductionTypeIds(areaIds: number[], productionType?: string) {
  if (productionType && productionType !== "all") {
    const rows = await querySmall<{ id: number }>("SELECT id FROM production_types WHERE name = ANY($1::text[])", [productionType.split(",")]);
    return rows.map((row) => row.id);
  }
  const rows = await querySmall<{ production_type_id: number }>("SELECT DISTINCT production_type_id FROM areas_production_types WHERE area_id = ANY($1::int[])", [areaIds]);
  return rows.map((row) => row.production_type_id);
}

export async function getProductionTypeOptions(areaIds: number[]) {
  const rows = await querySmall<{ name: string }>(
    "SELECT DISTINCT pt.name FROM production_types pt INNER JOIN areas_production_types apt ON apt.production_type_id=pt.id WHERE apt.area_id = ANY($1::int[]) ORDER BY pt.name",
    [areaIds],
  );
  return [{ value: "all", label: "All" }, ...rows.map((row) => ({ value: row.name, label: titleize(row.name) }))];
}

export function titleize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
