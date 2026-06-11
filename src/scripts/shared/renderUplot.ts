import { Canvas } from "skia-canvas";
import type { ChartRenderer, TimelineRendererOptions, FrameGenerator, RendererFactory } from "./renderVideo.ts";
import { renderVideo, type VideoProfile } from "./renderVideo.ts";
import { formatPower, formatPrice } from "../../shared/echartsFormatters.ts";
import { initDomShim, setShimCanvas, destroyDomShim } from "../../shared/uplotDomShim.ts";
import type uPlot from "uplot";

// ---------------------------------------------------------------------------
// Renderer

export async function createUplotRenderer(
  options: TimelineRendererOptions,
  getFramePayload?: FrameGenerator,
): Promise<ChartRenderer> {
  const width = options.width;
  const height = options.height;

  // Set up DOM shim BEFORE importing uPlot, because uPlot checks
  // typeof window at import time and caches doc = null if window is
  // not yet defined (see dist/uPlot.cjs.js lines 74-76).
  initDomShim();
  const canvas = new Canvas(Math.ceil(width), Math.ceil(height));
  setShimCanvas(canvas);

  const { default: uPlot } = await import("uplot");

  const uplotPayload = options.payload;
  const { opts, data, rawData, startTime, interval } = uplotPayload;

  // Rebuild timestamps from startTime + interval * index (avoids sending full array over wire).
  const count = (data[0]?.length ?? 0);
  const timestamps = new Array(count);
  for (let i = 0; i < count; i++) {
    timestamps[i] = startTime + i * interval;
  }
  const dataWithX = [timestamps, ...data] as any;

  // Build initial uPlot configuration.
  // Start from server-provided opts, apply baseOption overrides (if any),
  // then overlay video-specific settings.
  // Deep-merge nested objects like scales so the x-scale isn't dropped.
  const uplotOpts: uPlot.Options = {
    ...opts,
    ...options.baseOption,
    scales: { ...opts.scales, ...options.baseOption?.scales },
    width,
    height,
    // Disable interactions for SSR
    cursor: { show: false },
    select: { show: false },
    legend: { show: false },
    // No plugins for SSR
    plugins: [],
    // Fill canvas with white after clearRect so pixels are fully opaque.
    // This lets us skip the ffmpeg color=white...overlay compositing since
    // there's no transparency to composite over.
    hooks: {
      drawClear: [() => {
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }],
    },
  };

  // Apply axis value formatters matching the web frontend
  if (Array.isArray(uplotOpts.axes)) {
    uplotOpts.axes = uplotOpts.axes.map((axis) => {
      if (axis.scale === "y" || axis.scale === "power") {
        return { ...axis, values: (_u: uPlot, ticks: number[]) => ticks.map((v) => formatPower(v)) };
      }
      if (axis.scale === "price-l" || axis.scale === "price-r" || axis.scale === "percent") {
        return { ...axis, values: (_u: uPlot, ticks: number[]) => ticks.map((v) => formatPrice(v)) };
      }
      return axis;
    });
  }

  // Configure timezone-aware x-axis from the payload
  const timezone: string | undefined = (uplotPayload as any).timezone;
  if (timezone) {
    uplotOpts.tzDate = (ts: number) => uPlot.tzDate(new Date(ts * 1e3), timezone);
  }

  // Create the uPlot instance — the DOM shim provides document.
  // Instead of passing a DOM element (which requires HTMLElement to be defined),
  // pass a function that just calls _init() to kickstart the chart.
  const chart = new uPlot(uplotOpts, dataWithX, (_self: uPlot, _init: Function) => { _init(); });

  // Load the frame generator
  const fg = getFramePayload ?? await loadFrameGenerator(options);

  return {
    renderFrame(index: number) {
      const frameData = fg(index);
      // Frame generator returns { data: slicedColumns } for uPlot
      const slicedData = (frameData as any).data as (number | null)[][] | undefined;
      if (slicedData) {
        chart.setData(slicedData as any);
      }
    },
    async flushFrame(path: string) {
      await canvas.toFile(path, { format: "raw" });
    },
    dispose() {
      chart.destroy();
      destroyDomShim();
    },
  };
}

async function loadFrameGenerator(options: TimelineRendererOptions): Promise<FrameGenerator> {
  const mod = await import(options.frameGeneratorModule) as { createFrameGenerator?: (payload: Record<string, any>, params?: Record<string, any>) => FrameGenerator };
  if (!mod.createFrameGenerator) throw new Error(`Module ${options.frameGeneratorModule} does not export createFrameGenerator`);
  return mod.createFrameGenerator(options.payload, options.frameGeneratorParams);
}

// ---------------------------------------------------------------------------
// Convenience wrapper

export async function renderUplotVideo(
  profile: VideoProfile,
  rendererOptions: Omit<TimelineRendererOptions, "width" | "height">,
  options?: { description?: string },
) {
  await renderVideo(profile, rendererOptions, createUplotRenderer as RendererFactory, options);
}
