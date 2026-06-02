import { readFileSync, openSync, closeSync, write as fsWrite, constants as fs } from "node:fs";
import { availableParallelism } from "node:os";
import { isMainThread, Worker, workerData as nodeWorkerData } from "node:worker_threads";
import { join } from "node:path";
import { Canvas } from "skia-canvas";
import { processEchartsFormatters } from "./echartsFormatters.ts";
import { getEchartsForSsr } from "../dashboards/shared/echartsSsr.ts";
import { buildApp } from "../server.ts";
import { spawnFifoVideo, type VideoProfile } from "./ffmpegVideoWriter.ts";

export type { VideoProfile } from "./ffmpegVideoWriter.ts";

export type EchartsJsonPayload = {
  options: Record<string, any>;
  geoJsonUrl?: string;
  mapName?: string;
} & Record<string, any>;

export type TimelineRendererOptions = {
  payload: EchartsJsonPayload;
  frameOptions: Record<string, any>[];
  width: number;
  height: number;
  baseOption?: Record<string, any>;
};

// ---------------------------------------------------------------------------
// Fetch data

export async function fetchEchartsPayload<T extends EchartsJsonPayload = EchartsJsonPayload>(url: string) {
  const app = await buildApp();
  try {
    const response = await app.inject({ method: "GET", url });
    if (response.statusCode !== 200) throw new Error(`GET ${url} failed with ${response.statusCode}: ${response.body}`);
    return JSON.parse(response.body) as T;
  } finally { await app.close(); }
}

// ---------------------------------------------------------------------------
// Main entry

export async function renderEchartsVideo(
  profile: VideoProfile,
  rendererOptions: Omit<TimelineRendererOptions, "width" | "height">,
  options: { description?: string } = {},
) {
  const frameCount = rendererOptions.frameOptions.length;
  if (!frameCount) throw new Error(`No frames to render for ${profile.url}`);

  const raw = process.env.RENDER_MODE || "fast";
  const renderWorkers = Math.max(1, Math.min(raw === "fast" ? 4 : 2, availableParallelism()));
  if (raw !== "fast" && raw !== "slow") throw new Error(`Unknown RENDER_MODE=${raw}. Expected fast or slow.`);
  const ffmpegPreset = raw === "fast" ? "fast" : "veryslow";

  const rendererData = { ...rendererOptions, width: profile.width, height: profile.height };
  const wDesc = `${renderWorkers} worker${renderWorkers > 1 ? "s" : ""}`;
  console.log(`Rendering ${frameCount} ${options.description || "frames"} via ${wDesc}`);

  const sab = new SharedArrayBuffer(8);
  new Int32Array(sab)[0] = 0;

  const fifoVideo = spawnFifoVideo(profile, { renderMode: { ffmpegPreset } });
  const workerCount = Math.min(renderWorkers, frameCount);
  const exitErrors: Error[] = [];

  const workers = Array.from({ length: workerCount }, (_, i) =>
    new Worker(new URL("./renderEchartsVideo.ts", import.meta.url), {
      workerData: {
        __renderEchartsVideoWorker: true, ...rendererData,
        fifoPath: fifoVideo.fifoPath, sab, frameCount, workerIndex: i, workerCount,
      },
      execArgv: process.execArgv,
    }),
  );

  const kill = () => workers.forEach((w) => w.terminate());

  await Promise.all(workers.map((w) => new Promise<void>((r) => {
    w.on("error", (e) => { exitErrors.push(e instanceof Error ? e : new Error(String(e))); kill(); r(); });
    w.on("exit", (c) => { if (c) { exitErrors.push(new Error(`Worker exited with code ${c}`)); kill(); } r(); });
  })));

  if (exitErrors.length) { fifoVideo.close(); await fifoVideo.waitExit().catch(() => {}); throw exitErrors[0]; }
  const status = await fifoVideo.waitExit();
  if (status) throw new Error(`ffmpeg exited with code ${status}`);
}

// ---------------------------------------------------------------------------
// Worker

async function runFifoFrameWorker(
  createRenderer: () => Promise<{ renderFrame(i: number): Buffer; dispose(): any }>,
  fifoPath: string, sab: ArrayBuffer, frameCount: number, workerIndex: number, workerCount: number,
) {
  const renderer = await createRenderer();
  const fd = openSync(fifoPath, fs.O_WRONLY);
  const counter = new Int32Array(sab);

  try {
    for (let i = workerIndex; i < frameCount; i += workerCount) {
      const frame = renderer.renderFrame(i);

      // Wait for our turn: non-blocking wait until counter changes.
      // (Atomics.waitAsync lets V8 GC on this thread while waiting.)
      while (Atomics.load(counter, 0) !== i) {
        const cur = Atomics.load(counter, 0);
        const r = Atomics.waitAsync(counter, 0, cur);
        if (r.async) await r.value;
      }

      let written = 0;
      await new Promise<void>((resolve, reject) => {
        const write = () => fsWrite(fd, frame, written, (e, b) => {
          if (e) { reject(e); return; }
          written += b;
          written < frame.length ? write() : resolve();
        });
        write();
      });

      Atomics.add(counter, 0, 1);
      Atomics.notify(counter, 0, Infinity);
    }
  } finally { closeSync(fd); await renderer.dispose(); }
}

// ---------------------------------------------------------------------------
// ECharts rendering

async function createTimelineRenderer(options: TimelineRendererOptions) {
  const echarts = await getEchartsForSsr();
  echarts.setPlatformAPI({ createCanvas: () => new Canvas(1, 1) });
  if (options.payload.mapName && options.payload.geoJsonUrl) registerMap(echarts, options.payload.mapName, options.payload.geoJsonUrl);

  const canvas = new Canvas(options.width, options.height);
  const chart = echarts.init(canvas, undefined, { renderer: "canvas", ssr: true, width: options.width, height: options.height });
  const chartOption = processEchartsFormatters(options.payload.options);
  const baseOption = options.baseOption ? processEchartsFormatters(options.baseOption) : chartOption;

  if (baseOption.visualMap) {
    const top = baseOption.visualMap.top || 50;
    const bottom = baseOption.visualMap.bottom || 60;
    const itemHeight = options.height - top - bottom;
    baseOption.visualMap.itemHeight = itemHeight;
    if (Array.isArray(baseOption.graphic)) {
      for (const g of baseOption.graphic) {
        if (g.type === "text" && g.$value != null) g.top = top + ((500 - g.$value) / 500) * itemHeight;
      }
    }
  }

  chart.setOption({
    baseOption: {
      backgroundColor: "#ffffff",
      textStyle: { fontFamily: "DejaVu Sans, sans-serif" },
      ...baseOption,
      timeline: { type: "slider", data: options.frameOptions.map((_, i) => i), ...(baseOption.timeline || {}), show: false, currentIndex: 0 },
    },
    options: options.frameOptions,
  } as never, true);

  return {
    renderFrame(index: number) {
      chart.dispatchAction({ type: "timelineChange", currentIndex: index });
      return rgbaFrameBuffer(chart.renderToCanvas(), options.width, options.height);
    },
    dispose() { chart.dispose(); },
  };
}

function rgbaFrameBuffer(canvas: Canvas, width: number, height: number) {
  const d = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  return Buffer.from(d.buffer, d.byteOffset, d.byteLength);
}

function registerMap(echarts: any, mapName: string, geoJsonUrl: string) {
  if (echarts.getMap(mapName)) return;
  const p = join(process.cwd(), "public", geoJsonUrl.replace(/^\/+/, "").replace(/^assets\//, ""));
  echarts.registerMap(mapName, JSON.parse(readFileSync(p, "utf8")));
}

// ---------------------------------------------------------------------------
// Worker entry point

async function timelineWorkerMain() {
  const d = nodeWorkerData as Record<string, unknown>;
  const { fifoPath, sab, frameCount, workerIndex, workerCount, __renderEchartsVideoWorker: _, ...opts } = d;
  if (fifoPath && sab && typeof frameCount === "number" && typeof workerIndex === "number" && typeof workerCount === "number") {
    await runFifoFrameWorker(
      () => createTimelineRenderer(opts as TimelineRendererOptions),
      fifoPath as string, sab as ArrayBuffer, frameCount, workerIndex, workerCount,
    );
  } else { console.error("Worker missing fifoPath/sab"); process.exit(1); }
}

if (!isMainThread && nodeWorkerData?.__renderEchartsVideoWorker) {
  timelineWorkerMain().catch((e) => { console.error(e); process.exit(1); });
}
