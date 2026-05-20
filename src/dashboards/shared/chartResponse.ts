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

let canvasFontsRegistered = false;

async function renderEchartsPng(options: unknown, width: number, height: number) {
  const { createCanvas, GlobalFonts } = await import("@napi-rs/canvas");

  if (!canvasFontsRegistered) {
    const fontsDir = join(process.cwd(), "fonts");
    if (existsSync(fontsDir)) {
      GlobalFonts.loadFontsFromDir(fontsDir);
    }
    const dejavuSans = join(fontsDir, "DejaVuSans.ttf");
    const dejavuSansBold = join(fontsDir, "DejaVuSans-Bold.ttf");
    if (existsSync(dejavuSans)) GlobalFonts.registerFromPath(dejavuSans, "DejaVu Sans");
    if (existsSync(dejavuSansBold)) GlobalFonts.registerFromPath(dejavuSansBold, "DejaVu Sans");
    if (GlobalFonts.has("DejaVu Sans")) {
      GlobalFonts.setAlias("DejaVu Sans", "sans-serif");
      GlobalFonts.setAlias("DejaVu Sans", "Inter");
      GlobalFonts.setAlias("DejaVu Sans", "Helvetica");
      GlobalFonts.setAlias("DejaVu Sans", "Arial");
    }
    canvasFontsRegistered = true;
  }

  const echarts = await getEchartsForSsr();
  echarts.setPlatformAPI({ createCanvas: () => createCanvas(1, 1) });

  const canvas = createCanvas(width, height);
  const chart = echarts.init(canvas, undefined, { renderer: "canvas", ssr: true, width, height });

  try {
    chart.setOption({
      textStyle: { fontFamily: "DejaVu Sans, sans-serif" },
      ...(options as Record<string, unknown>),
    } as never);

    return chart.renderToCanvas().toBuffer("image/png");
  } finally {
    chart.dispose();
  }
}
