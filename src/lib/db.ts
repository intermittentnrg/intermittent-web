import "dotenv/config";
import pg from "pg";

type SqlLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
};

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
  const start = process.hrtime.bigint();
  const result = await getSmallPool().query(text, values);
  logSqlQuery(undefined, text, values, start, result.rowCount ?? result.rows.length);
  return result.rows as T[];
}

export function logSqlQuery(
  logger: SqlLogger | undefined,
  sql: string,
  values: unknown[],
  start: bigint,
  rowCount: number,
) {
  const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  const normalizedSql = normalizeSql(sql);
  const entry = {
    event: "sql_query",
    duration_ms: Number(durationMs.toFixed(3)),
    row_count: rowCount,
    sql: normalizedSql,
    values,
    runnable_sql: formatSqlForLog(normalizedSql, values),
  };

  if (logger) logger.info(entry, "sql query");
  else console.log(JSON.stringify({ level: 30, time: Date.now(), ...entry, msg: "sql query" }));
}

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

function formatSqlForLog(sql: string, values: unknown[]) {
  return sql.replace(/\$(\d+)\b/g, (placeholder, index) => {
    const value = values[Number(index) - 1];
    return value === undefined ? placeholder : sqlLiteralForLog(value);
  });
}

function sqlLiteralForLog(value: unknown): string {
  if (value === null) return "NULL";
  if (value instanceof Date) return pg.escapeLiteral(value.toISOString());
  if (Array.isArray(value)) return `ARRAY[${value.map(sqlLiteralForLog).join(",")}]`;

  switch (typeof value) {
    case "number":
      return Number.isFinite(value) ? String(value) : pg.escapeLiteral(String(value));
    case "bigint":
      return String(value);
    case "boolean":
      return value ? "TRUE" : "FALSE";
    case "string":
      return pg.escapeLiteral(value);
    default:
      return pg.escapeLiteral(JSON.stringify(value));
  }
}
