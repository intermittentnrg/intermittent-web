import "dotenv/config";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import type { MapSeriesOption } from "echarts/types/dist/echarts";
import { Canvas } from "skia-canvas";
import { getEchartsForSsr } from "../dashboards/shared/echartsSsr.ts";
import { buildApp } from "../server.ts";

type PriceMapProfile = {
  url: string;
  output: string;
  framerate: string;
  fps: string;
  aspectScale: number;
  mapZoom: number;
  mapCenter: [number, number];
  label: { prefix?: string; suffix?: string };
};

type PriceMapPayload = {
  options: {
    baseOption: Record<string, any>;
    options: Record<string, any>[];
  };
  geoJsonUrl?: string;
  mapName?: string;
};

type FrameMessage = {
  index: number;
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
};

type FrameSource = {
  frame(index: number): Promise<Buffer>;
  close(): Promise<void>;
};

const profiles: Record<string, PriceMapProfile> = {
  europe: {
    url: "/europe/all/all/tomorrow_to_tomorrow/price_map/echarts.json?resolution=15m",
    output: "render/price-map.mp4",
    framerate: "10",
    fps: "10",
    aspectScale: 0.75,
    mapZoom: 8.9,
    mapCenter: [6, 54],
    label: { prefix: "€" },
  },
  australia: {
    url: "/australia/region/all/tomorrow_to_tomorrow/price_map/echarts.json?resolution=5m",
    output: "render/price-map-australia.mp4",
    framerate: "15",
    fps: "15",
    aspectScale: 1,
    mapZoom: 9,
    mapCenter: [130, -25],
    label: { prefix: "$" },
  },
  nukemap: {
    url: "/all/all/all/previous_month_to_previous_month/generation_of_peak_map/echarts.json?resolution=1h&production_type=nuclear",
    output: "render/nukemap.mp4",
    framerate: "30",
    fps: "30",
    aspectScale: 0.65,
    mapZoom: 1.4,
    mapCenter: [7, 10],
    label: { suffix: "%" },
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
const url = process.argv[3] || process.env.PRICE_MAP_URL || profile.url;
const framerate = process.env.PRICE_MAP_VIDEO_FRAMERATE || profile.framerate;
const fps = process.env.PRICE_MAP_VIDEO_FPS || profile.fps;
const renderMode = process.env.PRICE_MAP_RENDER_MODE || "fast";
if (!["fast", "slow"].includes(renderMode)) {
  throw new Error(`Unknown PRICE_MAP_RENDER_MODE=${renderMode}. Expected fast or slow.`);
}
const ffmpegLogLevel = process.env.PRICE_MAP_FFMPEG_LOG_LEVEL || "warning";
const aspectScale = Number(process.env.PRICE_MAP_ASPECT_SCALE || profile.aspectScale);
const mapZoom = Number(process.env.PRICE_MAP_MAP_ZOOM || profile.mapZoom);
const mapCenter = (process.env.PRICE_MAP_MAP_CENTER?.split(",").map(Number) || profile.mapCenter) as [number, number];
const renderWorkers = Math.max(
  1,
  Number(process.env.PRICE_MAP_RENDER_WORKERS || Math.min(renderMode === "slow" ? 2 : 4, availableParallelism())),
);
const ffmpegPreset = process.env.PRICE_MAP_FFMPEG_PRESET || (renderMode === "slow" ? "veryslow" : undefined);
const ffmpegPresetArgs = ffmpegPreset ? ["-preset", ffmpegPreset] : [];
const ffmpegArgs = [
  "-hide_banner",
  "-loglevel", ffmpegLogLevel,
  "-stats",
  "-f", "rawvideo",
  "-pixel_format", "rgba",
  "-video_size", `${width}x${height}`,
  "-framerate", framerate,
  "-i", "pipe:0",
  "-c:v", "libx264",
  ...ffmpegPresetArgs,
  "-profile:v", "high",
  "-movflags", "+faststart",
  "-filter_complex", [
    `color=c=white:s=${width}x${height}:r=${fps}[bg]`,
    "[bg][0:v]overlay=shortest=1",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    `fps=${fps}`,
    "format=yuv420p",
  ].join(","),
  output,
  "-y",
];


async function main() {
  const payload = await fetchPayload();
  const frameCount = payload.options.options.length;
  if (frameCount === 0) {
    throw new Error(
      `No map frames returned for ${url}. ` +
        "Check that data has been imported for the requested date range, or pass an explicit URL: " +
        "npm run render:price-map -- render/output.mp4 /europe/all/all/2026-05-25_to_2026-05-25/price_map/echarts.json?resolution=15m",
    );
  }

  await renderVideo(payload, frameCount);
}

async function fetchPayload() {
  const app = await buildApp();
  try {
    const response = await app.inject({ method: "GET", url });
    if (response.statusCode !== 200) {
      throw new Error(`GET ${url} failed with ${response.statusCode}: ${response.body}`);
    }
    return JSON.parse(response.body) as PriceMapPayload;
  } finally {
    await app.close();
  }
}

async function renderVideo(payload: PriceMapPayload, frameCount: number) {
  console.log(`ffmpeg ${ffmpegArgs.join(" ")}`);
  console.log(`Rendering ${frameCount} frames in ${renderMode} mode with ${renderWorkers} striped timeline worker${renderWorkers === 1 ? "" : "s"}`);

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "inherit", "inherit"] });
  const frames = await createFrameSource(payload, frameCount);

  try {
    for (let i = 0; i < frameCount; i++) {
      await writeAll(ffmpeg.stdin, await frames.frame(i));
    }
    ffmpeg.stdin.end();
  } catch (error) {
    ffmpeg.stdin.destroy(error as Error);
    throw error;
  } finally {
    await frames.close();
  }

  const status = await new Promise<number>((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("exit", (code) => resolve(code ?? 1));
  });
  if (status !== 0) process.exit(status);
}

async function createFrameSource(payload: PriceMapPayload, frameCount: number): Promise<FrameSource> {
  if (renderWorkers <= 1 || frameCount <= 1) return createLocalFrameSource(payload);
  return createWorkerFrameSource(payload, frameCount);
}

async function createLocalFrameSource(payload: PriceMapPayload): Promise<FrameSource> {
  const renderer = await createFrameRenderer(payload);
  return {
    frame: async (index) => renderer.renderFrame(index),
    close: async () => renderer.dispose(),
  };
}

function createWorkerFrameSource(payload: PriceMapPayload, frameCount: number): FrameSource {
  type PendingFrame = {
    resolve: (frame: Buffer) => void;
    reject: (error: Error) => void;
  };

  const workerCount = Math.min(renderWorkers, frameCount);
  const workers = Array.from({ length: workerCount }, (_, workerIndex) =>
    new Worker(new URL(import.meta.url), {
      workerData: { payload, frameCount, workerIndex, workerCount },
      execArgv: process.execArgv,
    }),
  );
  const pending = new Map<number, PendingFrame>();
  const completed = new Map<number, Buffer>();
  let closed = false;
  let workerError: Error | undefined;

  const fail = (error: Error) => {
    workerError = error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  for (const worker of workers) {
    worker.on("message", (message: FrameMessage) => {
      const frame = Buffer.from(message.buffer, message.byteOffset, message.byteLength);
      const waiter = pending.get(message.index);
      if (waiter) {
        pending.delete(message.index);
        waiter.resolve(frame);
      } else {
        completed.set(message.index, frame);
      }
    });
    worker.on("error", fail);
    worker.on("exit", (code) => {
      if (!closed && code !== 0) fail(new Error(`Frame worker exited with code ${code}`));
    });
  }

  return {
    frame(index) {
      if (workerError) return Promise.reject(workerError);
      const ready = completed.get(index);
      if (ready) {
        completed.delete(index);
        return Promise.resolve(ready);
      }
      return new Promise((resolve, reject) => pending.set(index, { resolve, reject }));
    },
    async close() {
      closed = true;
      await Promise.all(workers.map((worker) => worker.terminate()));
    },
  };
}

async function createFrameRenderer(payload: PriceMapPayload) {
  const echarts = await getEchartsForSsr();
  echarts.setPlatformAPI({ createCanvas: () => new Canvas(1, 1) });
  registerMap(echarts, payload.mapName || "world", payload.geoJsonUrl || "/assets/world-rewound.geojson");

  const canvas = new Canvas(width, height);
  const chart = echarts.init(canvas, undefined, { renderer: "canvas", ssr: true, width, height });
  chart.setOption({
    backgroundColor: "#ffffff",
    textStyle: { fontFamily: "DejaVu Sans, sans-serif" },
    ...(timelineOption(payload.options) as Record<string, unknown>),
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

function timelineOption(options: PriceMapPayload["options"]) {
  const option = structuredClone(options);
  option.baseOption.animation = false;
  option.baseOption.series = mapSeriesOptions(priceLabelMapSeries(option.baseOption.series || []));
  option.baseOption.timeline = {
    ...option.baseOption.timeline,
    currentIndex: 0,
    show: false,
  };
  return option;
}

function mapSeriesOptions<T extends MapSeriesOption>(series: T[]) {
  return series.map((item) => item.type === "map" ? {
    ...item,
    aspectScale,
    center: mapCenter,
    zoom: mapZoom,
  } : item);
}

function priceLabelMapSeries<T extends MapSeriesOption>(series: T[]) {
  return series.map((item) => item.type === "map" ? {
    ...item,
    label: {
      ...item.label,
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
      ...item.emphasis,
      label: {
        ...item.emphasis?.label,
        show: true,
        fontFamily: "DejaVu Sans, sans-serif",
        fontWeight: "bold",
        formatter: (params: { value?: unknown }) => formatPriceLabel(params.value),
      },
    },
  } : item);
}

function formatPriceLabel(value: unknown) {
  const rawValue = Array.isArray(value) ? value[2] : value;
  const numberValue = Number(rawValue);
  if (Number.isNaN(numberValue)) return "";

  const labelValue = Number.isInteger(numberValue) ? numberValue : Math.round(numberValue);
  return `${profile.label.prefix || ""}${labelValue}${profile.label.suffix || ""}`;
}

function rgbaFrameBuffer(canvas: Canvas) {
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function registerMap(echarts: any, mapName: string, geoJsonUrl: string) {
  if (echarts.getMap(mapName)) return;

  const path = join(process.cwd(), "public", geoJsonUrl.replace(/^\/+/, "").replace(/^assets\//, ""));
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

async function workerMain() {
  if (!parentPort) throw new Error("Frame worker started without parentPort");

  const { payload, frameCount, workerIndex, workerCount } = workerData as {
    payload: PriceMapPayload;
    frameCount: number;
    workerIndex: number;
    workerCount: number;
  };
  const renderer = await createFrameRenderer(payload);

  try {
    for (let index = workerIndex; index < frameCount; index += workerCount) {
      const frame = renderer.renderFrame(index);
      if (!(frame.buffer instanceof ArrayBuffer)) throw new Error("Frame buffer is not transferable");
      parentPort.postMessage(
        { index, buffer: frame.buffer, byteOffset: frame.byteOffset, byteLength: frame.byteLength },
        [frame.buffer],
      );
    }
  } finally {
    renderer.dispose();
  }
}

if (isMainThread) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  workerMain().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
