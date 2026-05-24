import "dotenv/config";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import type { MapSeriesOption } from "echarts/types/dist/echarts";
import { getEchartsForSsr } from "../dashboards/shared/echartsSsr.ts";
import { buildApp } from "../server.ts";

type PriceMapProfile = {
  region: string;
  areaType: string;
  area: string;
  resolution: string;
  output: string;
  framerate: string;
  fps: string;
  aspectScale: number;
  mapZoom: number;
  mapCenter: [number, number];
  currency: "EUR" | "AUD";
};

const profiles: Record<string, PriceMapProfile> = {
  europe: {
    region: "europe",
    areaType: "all",
    area: "all",
    resolution: "15m",
    output: "render/price-map.mp4",
    framerate: "10",
    fps: "10",
    aspectScale: 0.75,
    mapZoom: 8.9,
    mapCenter: [6, 54],
    currency: "EUR",
  },
  australia: {
    region: "australia",
    areaType: "region",
    area: "all",
    resolution: "5m",
    output: "render/price-map-australia.mp4",
    framerate: "15",
    fps: "15",
    aspectScale: 1,
    mapZoom: 9,
    mapCenter: [130, -25],
    currency: "AUD",
  },
};

const profileName = process.env.PRICE_MAP_PROFILE || "europe";
const profile = profiles[profileName];
if (!profile) {
  throw new Error(`Unknown PRICE_MAP_PROFILE=${profileName}. Expected one of: ${Object.keys(profiles).join(", ")}`);
}

const width = Number(process.env.PRICE_MAP_WIDTH || 1200);
const height = Number(process.env.PRICE_MAP_HEIGHT || 1200);
const output = process.argv[2] || process.env.PRICE_MAP_VIDEO || profile.output;
const dateRange = process.argv[3] || process.env.PRICE_MAP_DATE_RANGE || tomorrowDateRange();
const resolution = process.env.PRICE_MAP_RESOLUTION || profile.resolution;
const url = `/${profile.region}/${profile.areaType}/${profile.area}/${dateRange}/price_map/echarts.json?resolution=${resolution}`;
const framerate = process.env.PRICE_MAP_VIDEO_FRAMERATE || profile.framerate;
const fps = process.env.PRICE_MAP_VIDEO_FPS || profile.fps;
const showPriceLabels = process.env.PRICE_MAP_PRICE_LABELS !== "0";
const hideLabelOverlap = process.env.PRICE_MAP_HIDE_LABEL_OVERLAP !== "0";
const aspectScale = Number(process.env.PRICE_MAP_ASPECT_SCALE || profile.aspectScale);
const mapZoom = Number(process.env.PRICE_MAP_MAP_ZOOM || profile.mapZoom);
const mapCenter = (process.env.PRICE_MAP_MAP_CENTER?.split(",").map(Number) || profile.mapCenter) as [number, number];


const vf = [
  `color=c=white:s=${width}x${height}:r=${fps}[bg]`,
  "[bg][0:v]overlay=shortest=1",
  "pad=ceil(iw/2)*2:ceil(ih/2)*2",
  `fps=${fps}`,
  "format=yuv420p",
].join(",");

type PriceMapPayload = {
  options: {
    baseOption: Record<string, any>;
    options: Record<string, any>[];
  };
  frames: { name: string; layout?: { title?: string } }[];
  geoJsonUrl?: string;
  mapName?: string;
};

async function main() {
  const app = await buildApp();
  try {
    const response = await app.inject({ method: "GET", url });
    if (response.statusCode !== 200) {
      throw new Error(`GET ${url} failed with ${response.statusCode}: ${response.body}`);
    }

    const payload = JSON.parse(response.body) as PriceMapPayload;
    const frameCount = payload.options.options.length;
    if (frameCount === 0) {
      throw new Error(
        `No price-map frames returned for ${dateRange}. ` +
          "Check that prices have been imported for that date range, or pass an explicit range: " +
          "npm run render:price-map -- render/price-map.mp4 YYYY-MM-DD_to_YYYY-MM-DD",
      );
    }

    const echarts = await getEchartsForSsr();
    echarts.setPlatformAPI({ createCanvas: () => createCanvas(1, 1) });
    registerMap(echarts, payload.mapName || "world", payload.geoJsonUrl || "/assets/world-rewound.geojson");

    const renderer = createFrameRenderer(echarts, payload);
    try {
      await renderVideo(renderer, frameCount);
    } finally {
      renderer.dispose();
    }
  } finally {
    await app.close();
  }
}

function createFrameRenderer(echarts: any, payload: PriceMapPayload) {
  const canvas = createCanvas(width, height);
  const chart = echarts.init(canvas, undefined, { renderer: "canvas", ssr: true, width, height });
  const option = timelineOption(payload.options);

  chart.setOption({
    backgroundColor: "#ffffff",
    textStyle: { fontFamily: "DejaVu Sans, sans-serif" },
    ...(option as Record<string, unknown>),
  } as never, true);

  return {
    renderFrame(index: number) {
      chart.dispatchAction({ type: "timelineChange", currentIndex: index });
      return rgbaFrameBuffer(chart.renderToCanvas());
    },
    dispose() {
      chart.dispose();
    },
  };
}

async function renderVideo(renderer: ReturnType<typeof createFrameRenderer>, frameCount: number) {
  const args = [
    "-f",
    "rawvideo",
    "-pixel_format",
    "rgba",
    "-video_size",
    `${width}x${height}`,
    "-framerate",
    framerate,
    "-i",
    "pipe:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryslow",
    "-profile:v",
    "high",
    "-movflags",
    "+faststart",
    "-filter_complex",
    vf,
    output,
    "-y",
  ];

  console.log(`ffmpeg ${args.map(shellQuote).join(" ")}`);
  const ffmpeg = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });

  for (let i = 0; i < frameCount; i++) {
    await writeAll(ffmpeg.stdin, renderer.renderFrame(i));
  }
  ffmpeg.stdin.end();

  const status = await new Promise<number>((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("exit", (code) => resolve(code ?? 1));
  });
  if (status !== 0) process.exit(status);
}

function rgbaFrameBuffer(canvas: any) {
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function timelineOption(options: PriceMapPayload["options"]) {
  const option = structuredClone(options);
  const series = option.baseOption.series || [];
  option.baseOption.series = mapSeriesOptions(showPriceLabels ? priceLabelMapSeries(series) : series);
  option.baseOption.timeline = {
    ...option.baseOption.timeline,
    currentIndex: 0,
    show: false,
  };
  option.baseOption.animation = false;
  return option;
}

function mapSeriesOptions<T extends MapSeriesOption>(input: T[]): T[] {
  return input.map((series) => {
    if (series.type !== "map") return series;

    return {
      ...series,
      aspectScale,
      center: mapCenter,
      zoom: mapZoom,
    };
  });
}

function priceLabelMapSeries<T extends MapSeriesOption>(input: T[]): T[] {
  return input.map((series) => ({
    ...series,
    label: {
      ...series.label,
      show: true,
      color: "#111111",
      fontFamily: "DejaVu Sans, sans-serif",
      fontSize: 18,
      fontWeight: "bold",
      textBorderColor: "#ffffff",
      textBorderWidth: 4,
      formatter: (params: { value?: unknown }) => formatPriceLabel(params.value),
    },
    emphasis: {
      ...series.emphasis,
      label: {
        ...series.emphasis?.label,
        show: true,
        fontFamily: "DejaVu Sans, sans-serif",
        fontWeight: "bold",
        formatter: (params: { value?: unknown }) => formatPriceLabel(params.value),
      },
    },
    labelLayout: {
      ...series.labelLayout,
      hideOverlap: hideLabelOverlap,
    },
  }));
}

function formatPriceLabel(value: unknown) {
  const price = Array.isArray(value) ? value[2] : value;
  if (price === null || price === undefined || price === "") return "";

  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice)) return "";

  const roundedPrice = Math.round(numericPrice);
  return profile.currency === "AUD" ? `$${roundedPrice}` : `${roundedPrice}€`;
}

function registerMap(echarts: any, mapName: string, geoJsonUrl: string) {
  if (echarts.getMap(mapName)) return;

  const path = join(
    process.cwd(),
    "public",
    geoJsonUrl.replace(/^\/+/, "").replace(/^assets\//, ""),
  );
  echarts.registerMap(mapName, JSON.parse(readFileSync(path, "utf8")));
}

function writeAll(stream: NodeJS.WritableStream, chunk: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    stream.on("error", onError);
    if (stream.write(chunk)) {
      cleanup();
      resolve();
    } else {
      stream.on("drain", onDrain);
    }
  });
}

function shellQuote(value: string) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}

function tomorrowDateRange() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  const end = new Date(start);
  return `${datePart(start)}_to_${datePart(end)}`;
}

function datePart(date: Date) {
  return date.toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
