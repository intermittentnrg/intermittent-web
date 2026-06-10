import { openSync, closeSync, constants as fs } from "node:fs";
import { availableParallelism } from "node:os";
import { isMainThread, Worker, workerData as nodeWorkerData } from "node:worker_threads";
import { buildApp } from "../../server.ts";
import { spawnFifoVideo, type VideoProfile } from "./ffmpegVideoWriter.ts";

export type { VideoProfile } from "./ffmpegVideoWriter.ts";

/** Function returned by createFrameGenerator — produces one options/frame object per index. */
export type FrameGenerator = (index: number) => Record<string, any>;

/** Factory signature expected of modules loaded via frameGeneratorModule. */
export type CreateFrameGenerator = (
  payload: Record<string, any>,
  params?: Record<string, any>,
) => FrameGenerator;

export type TimelineRendererOptions = {
  /** Raw response payload from the server (ECharts or uPlot format). */
  payload: Record<string, any>;
  frameCount: number;
  width: number;
  height: number;
  /**
   * Optional base options object. Passed through to the renderer factory.
   * For ECharts this is the base timeline option; for uPlot it can be additional opts.
   */
  baseOption?: Record<string, any>;
  /**
   * Absolute URL (file://) of a module that exports
   * `createFrameGenerator(payload, params?) => (index) => optionObject`.
   */
  frameGeneratorModule: string;
  /**
   * Optional extra parameters forwarded to createFrameGenerator.
   */
  frameGeneratorParams?: Record<string, any>;
};

/** Interface every chart-specific renderer must implement. */
export interface ChartRenderer {
  renderFrame(index: number): void;
  flushFrame(path: string): Promise<void>;
  dispose(): void;
}

/** Factory that creates a ChartRenderer from TimelineRendererOptions. */
export type RendererFactory = (options: TimelineRendererOptions) => Promise<ChartRenderer>;

// ---------------------------------------------------------------------------
// Fetch data

export async function fetchPayload<T = Record<string, any>>(url: string): Promise<T> {
  const app = await buildApp();
  try {
    const response = await app.inject({ method: "GET", url });
    if (response.statusCode !== 200) throw new Error(`GET ${url} failed with ${response.statusCode}: ${response.body}`);
    return JSON.parse(response.body) as T;
  } finally { await app.close(); }
}

// ---------------------------------------------------------------------------
// Main entry

export async function renderVideo(
  profile: VideoProfile,
  rendererOptions: Omit<TimelineRendererOptions, "width" | "height">,
  createRenderer: RendererFactory,
  options: { description?: string } = {},
) {
  const frameCount = rendererOptions.frameCount;
  if (!frameCount) throw new Error(`No frames to render for ${profile.url}`);

  const raw = process.env.RENDER_MODE || "fast";
  const maxWorkers = raw === "fast" ? 4 : 2;
  const renderWorkers = raw === "single" ? 0 : Math.max(1, Math.min(maxWorkers, availableParallelism()));
  if (!["fast", "slow", "single"].includes(raw)) throw new Error(`Unknown RENDER_MODE=${raw}. Expected fast, slow, or single.`);

  const rendererData = { ...rendererOptions, width: profile.width, height: profile.height };
  console.log(`Rendering ${frameCount} ${options.description || "frames"} via ${renderWorkers || "single"} worker${renderWorkers === 1 ? "" : "s"}`);

  const fifoVideo = spawnFifoVideo(profile, { renderMode: raw });
  const keeperFd = openSync(fifoVideo.fifoPath, fs.O_WRONLY);

  // Single-threaded mode
  if (!renderWorkers) {
    const renderer = await createRenderer(rendererData);
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

  // Multi-worker mode
  const writeToken = new SharedArrayBuffer(8);
  new Int32Array(writeToken)[0] = 0;

  const workerCount = Math.min(renderWorkers, frameCount);
  const exitErrors: Error[] = [];

  const workers = Array.from({ length: workerCount }, (_, i) =>
    new Worker(new URL("./renderVideo.ts", import.meta.url), {
      workerData: {
        __renderVideoWorker: true, ...rendererData,
        fifoPath: fifoVideo.fifoPath, writeToken, frameCount, workerIndex: i, workerCount,
        frameGeneratorModule: rendererOptions.frameGeneratorModule,
        frameGeneratorParams: rendererOptions.frameGeneratorParams,
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
  createRenderer: () => Promise<ChartRenderer>,
  fifoPath: string, writeToken: ArrayBuffer, frameCount: number, workerIndex: number, workerCount: number,
) {
  const renderer = await createRenderer();
  const counter = new Int32Array(writeToken);

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
// Worker entry point

async function videoWorkerMain() {
  const d = nodeWorkerData as Record<string, unknown>;
  const { fifoPath, writeToken, frameCount, workerIndex, workerCount, __renderVideoWorker: _, frameGeneratorModule, ...rest } = d;

  if (!fifoPath || !writeToken || typeof frameCount !== "number" || typeof workerIndex !== "number" || typeof workerCount !== "number") {
    console.error("Worker missing fifoPath/sab"); process.exit(1);
  }

  // Dynamically import the frame generator module to get createFrameGenerator
  const mod = await import(d.frameGeneratorModule as string) as { createFrameGenerator?: CreateFrameGenerator };
  const createFrameGen = mod.createFrameGenerator;
  if (!createFrameGen) {
    console.error("Worker: frameGeneratorModule does not export createFrameGenerator"); process.exit(1);
  }

  // Determine the renderer type from the payload's chartLibrary field
  const payload = d.payload as Record<string, any>;
  const chartLibrary: string = payload?.chartLibrary || "echarts";

  // Instantiate the per-frame generator function
  const frameGeneratorParams = d.frameGeneratorParams as Record<string, any> | undefined;
  const getFramePayload = createFrameGen(payload, frameGeneratorParams);

  // Build the renderer factory based on chart library
  let createRenderer: () => Promise<ChartRenderer>;

  if (chartLibrary === "uplot") {
    // uPlot renderer — dynamically import to avoid loading ECharts when not needed
    const { createUplotRenderer } = await import("./renderUplot.ts");
    createRenderer = () => createUplotRenderer(rest as TimelineRendererOptions, getFramePayload);
  } else {
    // ECharts renderer (default)
    const { createEchartsRenderer } = await import("./renderEcharts.ts");
    createRenderer = () => createEchartsRenderer(rest as TimelineRendererOptions, getFramePayload);
  }

  await runFifoFrameWorker(
    createRenderer,
    fifoPath as string, writeToken as ArrayBuffer, frameCount, workerIndex, workerCount,
  );
}

if (!isMainThread && nodeWorkerData?.__renderVideoWorker) {
  videoWorkerMain().catch((e) => { console.error(e); process.exit(1); });
}
