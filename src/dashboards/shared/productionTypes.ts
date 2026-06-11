import { querySmall } from "../../lib/db.ts";
import { titleize } from "./text.ts";

export async function getProductionTypeIds(
  areaIds: number[],
  productionType?: string,
) {
  if (productionType && productionType !== "all") {
    const rows = await querySmall<{ id: number }>(
      "SELECT id FROM production_types WHERE name = ANY($1::text[])",
      [productionType.split(",")],
    );
    return rows.map((row) => row.id);
  }
  const rows = await querySmall<{ production_type_id: number }>(
    "SELECT DISTINCT production_type_id FROM areas_production_types WHERE area_id = ANY($1::int[])",
    [areaIds],
  );
  return rows.map((row) => row.production_type_id);
}

export async function getProductionTypeGroupOptions(areaIds: number[]) {
  const rows = await querySmall<{ id: number; name: string }>(
    `SELECT DISTINCT ptg.id, ptg.name
FROM production_type_groups ptg
INNER JOIN production_types pt ON pt.production_type_group_id = ptg.id
INNER JOIN areas_production_types apt ON apt.production_type_id = pt.id
WHERE apt.area_id = ANY($1::int[])
ORDER BY ptg.name`,
    [areaIds],
  );
  return rows.map((row) => ({ value: row.name, label: row.name.replace(/^\d+_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }));
}

export async function getProductionTypeOptions(areaIds: number[]) {
  const rows = await querySmall<{ name: string }>(
    "SELECT DISTINCT pt.name FROM production_types pt INNER JOIN areas_production_types apt ON apt.production_type_id=pt.id WHERE apt.area_id = ANY($1::int[]) ORDER BY pt.name",
    [areaIds],
  );
  return [
    { value: "all", label: "All" },
    ...rows.map((row) => ({ value: row.name, label: titleize(row.name) })),
  ];
}
