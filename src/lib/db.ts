import pg from "pg";

export const smallPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  application_name: "power-charts-small",
});

export const chartPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  application_name: "power-charts-chart",
});

export async function querySmall<T = unknown>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await smallPool.query(text, values);
  return result.rows as T[];
}
