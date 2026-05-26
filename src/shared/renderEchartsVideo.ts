import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { isMainThread, parentPort, Worker, workerData as nodeWorkerData } from "node:worker_threads";
import { join } from "node:path";
import { Canvas } from "skia-canvas";
import { processEchartsFormatters } from "./echartsFormatters.ts";
import { getEchartsForSsr } from "../dashboards/shared/echartsSsr.ts";
import { buildApp } from "../server.ts";
import { renderFrameSourceToVideo, type FrameSource, type VideoProfile } from "./ffmpegVideoWriter.ts";

export type EchartsJsonPayload = {
  options: Record<string, any>;
  geoJsonUrl?: string;
  mapName?: string;
} & Record<string, any>;

export type { VideoProfile } from "./ffmpegVideoWriter.ts";

export type TimelineRendererOptions = {
  payload: EchartsJsonPayload;
  frameOptions: Record<string, any>[];
  width: number;
  height: number;
  baseOption?: Record<string, any>;
};

type TimelineWorkerRendererData = TimelineRendererOptions;

type RenderModeConfig = {
  name: "fast" | "slow";
  workers: number;
  ffmpegPreset: string;
};

function renderModeConfig(value = process.env.RENDER_MODE || "fast"): RenderModeConfig {
  if (value === "fast") return { name: "fast", workers: 4, ffmpegPreset: "fast" };
  if (value === "slow") return { name: "slow", workers: 2, ffmpegPreset: "veryslow" };
  throw new Error(`Unknown RENDER_MODE=${value}. Expected fast or slow.`);
}

type FrameRenderer = {
  renderFrame(index: number): Buffer;
  dispose(): Promise<void> | void;
};

type FrameMessage = {
  index: number;
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
};

type StripedWorkerData<TWorkerData extends Record<string, unknown>> = TWorkerData & {
  frameCount: number;
  workerIndex: number;
  workerCount: number;
};

export async function fetchEchartsPayload<T extends EchartsJsonPayload = EchartsJsonPayload>(url: string) {
  const app = await buildApp();
  try {
    const response = await app.inject({ method: "GET", url });
    if (response.statusCode !== 200) {
      throw new Error(`GET ${url} failed with ${response.statusCode}: ${response.body}`);
    }
    return JSON.parse(response.body) as T;
  } finally {
    await app.close();
  }
}

export async function renderEchartsVideo(
  profile: VideoProfile,
  rendererOptions: Omit<TimelineRendererOptions, "width" | "height">,
  options: { description?: string } = {},
) {
  const frameCount = rendererOptions.frameOptions.length;
  if (frameCount === 0) throw new Error(`No frames to render for ${profile.url}`);

  const renderMode = renderModeConfig();
  const renderWorkers = Math.max(1, Math.min(renderMode.workers, availableParallelism()));
  const rendererData: TimelineWorkerRendererData = {
    ...rendererOptions,
    width: profile.width,
    height: profile.height,
  };
  const workerDescription = `${renderMode.name} mode with ${renderWorkers} striped timeline worker${renderWorkers === 1 ? "" : "s"}`;
  await renderStripedFrameSourceToVideo(
    profile,
    frameCount,
    renderWorkers,
    () => createTimelineRenderer(rendererData),
    { url: new URL("./renderEchartsVideo.ts", import.meta.url), data: { __renderEchartsVideoWorker: true, ...rendererData } },
    {
      description: options.description ? `${options.description} in ${workerDescription}` : `frames in ${workerDescription}`,
      renderMode,
    },
  );
}

async function renderStripedFrameSourceToVideo<TWorkerData extends Record<string, unknown>>(
  profile: VideoProfile,
  frameCount: number,
  renderWorkers: number,
  createRenderer: () => Promise<FrameRenderer>,
  worker: { url: URL; data: TWorkerData },
  options: { description?: string; renderMode: RenderModeConfig },
) {
  const frames = await createFrameSource(frameCount, renderWorkers, createRenderer, worker);
  await renderFrameSourceToVideo(profile, frameCount, frames, options);
}

async function createFrameSource<TWorkerData extends Record<string, unknown>>(
  frameCount: number,
  renderWorkers: number,
  createLocalRenderer: () => Promise<FrameRenderer>,
  worker: { url: URL; data: TWorkerData },
): Promise<FrameSource> {
  if (renderWorkers <= 1 || frameCount <= 1) return createLocalFrameSource(createLocalRenderer);
  return createWorkerFrameSource(frameCount, renderWorkers, worker.url, worker.data);
}

async function createLocalFrameSource(createRenderer: () => Promise<FrameRenderer>): Promise<FrameSource> {
  const renderer = await createRenderer();
  return {
    frame: async (index) => renderer.renderFrame(index),
    close: async () => renderer.dispose(),
  };
}

function createWorkerFrameSource<TWorkerData extends Record<string, unknown>>(
  frameCount: number,
  renderWorkers: number,
  workerUrl: URL,
  workerData: TWorkerData,
): FrameSource {
  type PendingFrame = {
    resolve: (frame: Buffer) => void;
    reject: (error: Error) => void;
  };

  const workerCount = Math.min(renderWorkers, frameCount);
  const workers = Array.from({ length: workerCount }, (_, workerIndex) =>
    new Worker(workerUrl, {
      workerData: { ...workerData, frameCount, workerIndex, workerCount },
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

async function runStripedFrameWorkerFromData<TWorkerData extends Record<string, unknown>>(
  data: StripedWorkerData<TWorkerData>,
  createRenderer: (data: TWorkerData) => Promise<FrameRenderer>,
) {
  const { frameCount, workerIndex, workerCount, ...rendererData } = data;
  await runStripedFrameWorker(
    frameCount,
    workerIndex,
    workerCount,
    () => createRenderer(rendererData as unknown as TWorkerData),
  );
}

async function runStripedFrameWorker(
  frameCount: number,
  workerIndex: number,
  workerCount: number,
  createRenderer: () => Promise<FrameRenderer>,
) {
  if (!parentPort) throw new Error("Frame worker started without parentPort");

  const renderer = await createRenderer();
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
    await renderer.dispose();
  }
}

async function createTimelineRenderer(options: TimelineRendererOptions): Promise<FrameRenderer> {
  const echarts = await getEchartsForSsr();
  echarts.setPlatformAPI({ createCanvas: () => new Canvas(1, 1) });
  if (options.payload.mapName && options.payload.geoJsonUrl) registerMap(echarts, options.payload.mapName, options.payload.geoJsonUrl);

  const canvas = new Canvas(options.width, options.height);
  const chart = echarts.init(canvas, undefined, { renderer: "canvas", ssr: true, width: options.width, height: options.height });
  const chartOption = processEchartsFormatters(options.payload.options);
  const baseOption = options.baseOption ? processEchartsFormatters(options.baseOption) : chartOption;
  chart.setOption({
    baseOption: {
      backgroundColor: "#ffffff",
      textStyle: { fontFamily: "DejaVu Sans, sans-serif" },
      ...baseOption,
      timeline: {
        type: "slider",
        data: options.frameOptions.map((_, index) => index),
        ...(baseOption.timeline || {}),
        show: false,
        currentIndex: 0,
      },
    },
    options: options.frameOptions,
  } as never, true);

  return {
    renderFrame(index: number) {
      chart.dispatchAction({ type: "timelineChange", currentIndex: index });
      return rgbaFrameBuffer(chart.renderToCanvas(), options.width, options.height);
    },
    dispose() {
      chart.dispose();
    },
  };
}

function rgbaFrameBuffer(canvas: Canvas, width: number, height: number) {
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function registerMap(echarts: any, mapName: string, geoJsonUrl: string) {
  if (echarts.getMap(mapName)) return;
  const path = join(process.cwd(), "public", geoJsonUrl.replace(/^\/+/, "").replace(/^assets\//, ""));
  echarts.registerMap(mapName, JSON.parse(readFileSync(path, "utf8")));
}

async function timelineWorkerMain() {
  await runStripedFrameWorkerFromData(
    nodeWorkerData as StripedWorkerData<TimelineWorkerRendererData & { __renderEchartsVideoWorker: true }>,
    ({ __renderEchartsVideoWorker: _, ...rendererOptions }) => createTimelineRenderer(rendererOptions),
  );
}

if (!isMainThread && nodeWorkerData?.__renderEchartsVideoWorker) {
  timelineWorkerMain().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
