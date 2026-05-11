import "dotenv/config";
import pg from "pg";

function databaseUrl() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  return url;
}

function poolConfig(max: number, applicationName: string): pg.PoolConfig {
  const schemaSearchPath = process.env.PGSCHEMA;

  if (!schemaSearchPath) {
    throw new Error("PGSCHEMA is not set");
  }

  return {
    connectionString: databaseUrl(),
    max,
    application_name: applicationName,
    options: `-c search_path=${schemaSearchPath}`,
  };
}

let smallPool: pg.Pool | undefined;
let chartPool: pg.Pool | undefined;

export function getSmallPool() {
  smallPool ||= new pg.Pool(poolConfig(4, "power-charts-small"));

  return smallPool;
}

export function getChartPool() {
  chartPool ||= new pg.Pool(poolConfig(2, "power-charts-chart"));

  return chartPool;
}

export async function querySmall<T = unknown>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getSmallPool().query(text, values);
  return result.rows as T[];
}
