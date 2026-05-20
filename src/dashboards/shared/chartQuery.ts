import type { FastifyRequest } from "fastify";
import { cancelableChartQuery } from "../../lib/cancelableQuery.ts";

export async function chartQuery<T = unknown>(
  request: FastifyRequest,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const rows = await cancelableChartQuery<Record<string, unknown>>(request, text, values);
  return (rows ?? []).map(coerceSqlNumbers) as T[];
}

function coerceSqlNumbers(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
        ? Number(value)
        : value,
    ]),
  );
}
