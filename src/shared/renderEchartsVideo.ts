import { readFileSync, openSync, closeSync, constants as fs } from "node:fs";
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
  frameCount: number;
  width: number;
  height: number;
  baseOption?: Record<string, any>;
  stepPoints?: number;   // for offset-based frame stepping
  windowPoints?: number; // data points per frame
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
  const frameCount = rendererOptions.frameCount;
  if (!frameCount) throw new Error(`No frames to render for ${profile.url}`);

  const raw = process.env.RENDER_MODE || "fast";
  const ffmpegPreset = raw === "fast" || raw === "single" ? "fast" : "veryslow";
  const renderWorkers = raw === "single" ? 0 : Math.max(1, Math.min(raw === "fast" ? 4 : 2, availableParallelism()));
  if (!["fast", "slow", "single"].includes(raw)) throw new Error(`Unknown RENDER_MODE=${raw}. Expected fast, slow, or single.`);

  const rendererData = { ...rendererOptions, width: profile.width, height: profile.height };
  console.log(`Rendering ${frameCount} ${options.description || "frames"} via ${renderWorkers || "single"} worker${renderWorkers === 1 ? "" : "s"}`);

  const fifoVideo = spawnFifoVideo(profile, { renderMode: { ffmpegPreset } });
  // Keeper fd — stays open so children can toFile() without tripping EOF.
  const keeperFd = openSync(fifoVideo.fifoPath, fs.O_WRONLY);

  // Single-threaded mode: render in the main thread for profiling.
  if (!renderWorkers) {
    const renderer = await createTimelineRenderer(rendererData);
    try {
      for (let i = 0; i < frameCount; i++) {
        renderer.renderFrame(i);
        await renderer.flushFrame(fifoVideo.fifoPath);
      }
    } finally { closeSync(keeperFd); await renderer.dispose(); }
    const status = await fifoVideo.waitExit();
    if (status) throw new Error(`ffmpeg exited with code ${status}`);
    return;
  }

  const sab = new SharedArrayBuffer(8);
  new Int32Array(sab)[0] = 0;

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

  closeSync(keeperFd);
  if (exitErrors.length) { fifoVideo.close(); await fifoVideo.waitExit().catch(() => {}); throw exitErrors[0]; }
  const status = await fifoVideo.waitExit();
  if (status) throw new Error(`ffmpeg exited with code ${status}`);
}

// ---------------------------------------------------------------------------
// Worker

async function runFifoFrameWorker(
  createRenderer: () => Promise<{ renderFrame(i: number): void; flushFrame(p: string): Promise<void>; dispose(): any }>,
  fifoPath: string, sab: ArrayBuffer, frameCount: number, workerIndex: number, workerCount: number,
) {
  const renderer = await createRenderer();
  const counter = new Int32Array(sab);

  try {
    for (let i = workerIndex; i < frameCount; i += workerCount) {
      renderer.renderFrame(i);

      while (Atomics.load(counter, 0) !== i) {
        const cur = Atomics.load(counter, 0);
        const r = Atomics.waitAsync(counter, 0, cur);
        if (r.async) await r.value;
      }

      await renderer.flushFrame(fifoPath);

      Atomics.add(counter, 0, 1);
      Atomics.notify(counter, 0, Infinity);
    }
  } finally { await renderer.dispose(); }
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

  // Set up the chart with full data (no timeline — each frame updates xAxis only).
  chart.setOption({
    backgroundColor: "#ffffff",
    textStyle: { fontFamily: "DejaVu Sans, 'Noto Color Emoji', sans-serif" },
    ...baseOption,
  } as never, true);

  const allSeries = options.payload.options!.series;
  // Two render modes:
  // 1. Offset-based (electricity mix): stepPoints tells us the data-array
  //    stride.  We slice series at `index * stepPts`.
  // 2. Payload-based (price map): each frame is a complete {title, series}
  //    object from the API; no series slicing needed.
  const isOffset = !!options.stepPoints;
  const framePayloads = options.payload.options?.options as Record<string,any>[] | undefined;
  const winPts = options.windowPoints ?? 2016;
  const stepPts = options.stepPoints ?? 1;
  const d0 = allSeries[0]?.data;
  // Pre-compute the fixed window duration so every frame has the exact same
  // x-axis span — avoids subtle jitter from timestamp rounding / gapfill.
  const windowMs = d0 ? (d0[winPts - 1]?.[0] ?? 0) - (d0[0]?.[0] ?? 0) : 0;
  const stepMs = d0 && d0.length > 1 ? d0[1][0] - d0[0][0] : 0;

  return {
    renderFrame(index: number) {
      if (isOffset) {
        const start = index * stepPts;
        const end = Math.min(start + winPts, allSeries![0].data.length);
        const clipped = allSeries!.map((s: any) => ({
          ...s,
          data: s.data.slice(start, end),
        }));
        const xMin = d0![start][0];
        const xMax = xMin + windowMs; // fixed span instead of d0[end-1][0]
        const update: any = { series: clipped, xAxis: { min: xMin, max: xMax } };
        chart.setOption(update);
      } else if (framePayloads) {
        chart.setOption(framePayloads[index]);
      }
      chart.renderToCanvas();
    },
    async flushFrame(path: string) {
      await canvas.toFile(path, { format: "raw" });
    },
    dispose() { chart.dispose() },
  };
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
