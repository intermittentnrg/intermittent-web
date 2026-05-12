import type { FastifyReply } from "fastify";
import { buildDualAxisOptions } from "./chartOptions.js";

export async function sendChartOptions(
  reply: FastifyReply,
  options: unknown,
  timezone: string,
  extra = {},
  height = 567,
) {
  return reply.header("Cache-Control", "public, max-age=3600").send({
    options,
    height,
    timezone,
    ...extra,
  });
}

export async function sendDualAxisChart(
  reply: FastifyReply,
  series: any[],
  title: string,
  timezone: string,
  extra = {},
) {
  return sendChartOptions(
    reply,
    buildDualAxisOptions(series, title),
    timezone,
    extra,
  );
}
