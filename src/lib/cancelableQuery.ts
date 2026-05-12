import type { FastifyRequest } from "fastify";
import type pg from "pg";
import { getChartPool, logSqlQuery } from "./db.js";

export async function cancelableChartQuery<T = unknown>(
  req: FastifyRequest,
  text: string,
  values: unknown[] = [],
): Promise<T[] | null> {
  const client = await getChartPool().connect();

  let aborted = false;
  let released = false;

  function destroyClient() {
    if (released) return;

    aborted = true;
    released = true;

    // Blunt but reliable: close the socket/backend running the query.
    client.release(true);
  }

  req.raw.once("aborted", destroyClient);

  try {
    await client.query("SET statement_timeout = '60s'");

    const start = process.hrtime.bigint();
    const result = await client.query(text, values);
    logSqlQuery(req.log, text, values, start, result.rowCount ?? result.rows.length);

    if (aborted) return null;

    released = true;
    client.release();

    return result.rows as T[];
  } catch (error) {
    if (!released) {
      released = true;
      client.release(true);
    }

    if (aborted) return null;

    throw error;
  } finally {
    req.raw.off("aborted", destroyClient);
  }
}
