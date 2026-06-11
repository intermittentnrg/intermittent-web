import type { FastifyReply, FastifyRequest } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { processEchartsFormatters } from "../../shared/echartsFormatters.ts";
import { buildDualAxisOptions, applyTimeAxis } from "./chartOptions.ts";
import { getEchartsForSsr } from "./echartsSsr.ts";
import type { UplotPayload } from "./uplotOptions.ts";
import { renderUplotPng } from "./renderUplotPng.ts";

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

export async function sendUplotResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  // Build unified response with panels array
  const response: Record<string, unknown> = {
    chartLibrary: "uplot",
    ...extra,
  };

  if (payload.panels) {
    // Multi-panel: payload already has panels key + top-level fields
    Object.assign(response, payload);
  } else {
    // Single panel: wrap in array, hoist common fields to top level
    const commonFields = ["startTime", "interval", "timezone", "height", "title"] as const;
    const panelEntry: Record<string, unknown> = {};
    for (const key of Object.keys(payload)) {
      if ((commonFields as readonly string[]).includes(key)) {
        response[key] = payload[key];
      } else {
        panelEntry[key] = payload[key];
      }
    }
    response.panels = [panelEntry];
  }

  // For .png requests, render server-side with uPlot + skia-canvas
  if (request.url.split("?", 1)[0].endsWith(".png")) {
    const width = 1200;
    const imageHeight = 630;
    const png = await renderUplotPng(response, width, imageHeight);
    return reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=3600")
      .send(png);
  }

  return reply
    .header("Cache-Control", "public, max-age=3600")
    .send(response);
}

export async function sendDualAxisChart(
  request: FastifyRequest,
  reply: FastifyReply,
  series: any[],
  title: string,
  timezone: string,
  extra: Record<string, unknown> = {},
  startTime?: number,
  interval?: number,
) {
  return sendChartResponse(
    request,
    reply,
    buildDualAxisOptions(series, title, startTime, interval),
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
    const chartOptions = applyTimeAxis(processEchartsFormatters(options as Record<string, unknown>) as Record<string, any>);
    const textStyle = typeof chartOptions.textStyle === "object" && chartOptions.textStyle !== null
      ? chartOptions.textStyle as Record<string, unknown>
      : {};

    const mapOption = (option: unknown, mapper: (item: Record<string, any>) => Record<string, any>) => {
      const mapItem = (item: unknown) => typeof item === "object" && item !== null
        ? mapper(item as Record<string, any>)
        : item;
      return Array.isArray(option) ? option.map(mapItem) : mapItem(option);
    };
    const scaleText = (option: unknown, fontSize: number) => mapOption(option, (item) => ({
      ...item,
      textStyle: { ...(item.textStyle || {}), fontSize },
    }));
    const scaleAxisText = (axis: unknown, fontSize: number) => mapOption(axis, (item) => ({
      ...item,
      axisLabel: { ...(item.axisLabel || {}), fontSize },
      nameTextStyle: { ...(item.nameTextStyle || {}), fontSize },
    }));

    chart.setOption({
      ...chartOptions,
      // Social preview cards are rendered onto arbitrary page backgrounds by crawlers.
      // Force an opaque background so the PNG never exposes the transparent canvas.
      backgroundColor: "#ffffff",
      textStyle: { ...textStyle, fontFamily: "DejaVu Sans, 'Noto Color Emoji', sans-serif", fontSize: 18 },
      title: scaleText(chartOptions.title, 28),
      legend: scaleText(chartOptions.legend, 18),
      xAxis: scaleAxisText(chartOptions.xAxis, 18),
      yAxis: scaleAxisText(chartOptions.yAxis, 18),
    } as never);

    return chart.renderToCanvas().toBuffer("png");
  } finally {
    chart.dispose();
  }
}
