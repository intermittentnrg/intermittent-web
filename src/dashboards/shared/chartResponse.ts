import type { FastifyReply, FastifyRequest } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import echarts = require("echarts");
import sharp from "sharp";
import { buildDualAxisOptions } from "./chartOptions.js";

type ChartPayload = {
  options: unknown;
  height: number;
  timezone: string;
} & Record<string, unknown>;

export async function sendChartResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  options: unknown,
  timezone: string,
  extra: Record<string, unknown> = {},
  height = 567,
) {
  const payload: ChartPayload = {
    options,
    height,
    timezone,
    ...extra,
  };

  if (request.url.split("?", 1)[0].endsWith(".webp")) {
    if (typeof extra.mapName === "string" && typeof extra.geoJsonUrl === "string") {
      registerMapForSsr(extra.mapName, extra.geoJsonUrl);
    }

    const width = 1200;
    const imageHeight = 630;
    const svg = renderEchartsSvg(options, width, imageHeight);
    const webp = await sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();

    return reply
      .header("Content-Type", "image/webp")
      .header("Cache-Control", "public, max-age=3600")
      .send(webp);
  }

  return reply.header("Cache-Control", "public, max-age=3600").send(payload);
}

export async function sendDualAxisChart(
  request: FastifyRequest,
  reply: FastifyReply,
  series: any[],
  title: string,
  timezone: string,
  extra: Record<string, unknown> = {},
) {
  return sendChartResponse(
    request,
    reply,
    buildDualAxisOptions(series, title),
    timezone,
    extra,
  );
}

function registerMapForSsr(mapName: string, geoJsonUrl: string) {
  if (echarts.getMap(mapName)) return;

  const geoJsonPath = join(
    process.cwd(),
    "public",
    geoJsonUrl.replace(/^\/+/, "").replace(/^assets\//, ""),
  );
  if (!existsSync(geoJsonPath)) return;

  echarts.registerMap(mapName, JSON.parse(readFileSync(geoJsonPath, "utf8")));
}

function renderEchartsSvg(options: unknown, width: number, height: number) {
  const chart = echarts.init(null, undefined, { renderer: "svg", ssr: true, width, height });
  try {
    chart.setOption(options as never);
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}
