import type { FastifyReply, FastifyRequest } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDualAxisOptions } from "./chartOptions.ts";
import { getEchartsForSsr } from "./echartsSsr.ts";

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

  if (request.url.split("?", 1)[0].endsWith(".png")) {
    if (typeof extra.mapName === "string" && typeof extra.geoJsonUrl === "string") {
      await registerMapForSsr(extra.mapName, extra.geoJsonUrl);
    }

    const width = 1200;
    const imageHeight = 630;
    const png = await renderEchartsPng(options, width, imageHeight);

    return reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=3600")
      .send(png);
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

async function registerMapForSsr(mapName: string, geoJsonUrl: string) {
  const echarts = await getEchartsForSsr();
  if (echarts.getMap(mapName)) return;

  const geoJsonPath = join(
    process.cwd(),
    "public",
    geoJsonUrl.replace(/^\/+/, "").replace(/^assets\//, ""),
  );
  if (!existsSync(geoJsonPath)) return;

  echarts.registerMap(mapName, JSON.parse(readFileSync(geoJsonPath, "utf8")));
}

async function renderEchartsPng(options: unknown, width: number, height: number) {
  const { Canvas } = await import("skia-canvas");

  const echarts = await getEchartsForSsr();
  echarts.setPlatformAPI({ createCanvas: () => new Canvas(1, 1) });

  const canvas = new Canvas(width, height);
  const chart = echarts.init(canvas, undefined, { renderer: "canvas", ssr: true, width, height });

  try {
    chart.setOption({
      textStyle: { fontFamily: "DejaVu Sans, sans-serif" },
      ...(options as Record<string, unknown>),
    } as never);

    return chart.renderToCanvas().toBuffer("png");
  } finally {
    chart.dispose();
  }
}
