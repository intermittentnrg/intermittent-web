import type { FastifyRequest } from "fastify";
import { cancelableChartQuery } from "../../lib/cancelableQuery.js";

export async function chartQuery<T = unknown>(
  request: FastifyRequest,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const rows = await cancelableChartQuery<T>(request, text, values);
  return rows ?? [];
}
