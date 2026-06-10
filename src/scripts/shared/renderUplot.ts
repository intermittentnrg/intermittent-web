import { Canvas, Path2D } from "skia-canvas";
import type { ChartRenderer, TimelineRendererOptions, FrameGenerator, RendererFactory } from "./renderVideo.ts";
import { renderVideo, type VideoProfile } from "./renderVideo.ts";
import { formatPower, formatPrice } from "../../shared/echartsFormatters.ts";
import type uPlot from "uplot";

// ---------------------------------------------------------------------------
// Minimal DOM shim so uPlot can create its canvas and render headlessly.
// uPlot calls document.createElement('canvas') internally; we return a skia
// Canvas that it can draw to.

let shimActive = false;

function setupDomShim(width: number, height: number): Canvas {
  // Guard: only set up once per renderer instance
  if (shimActive) return null as any;

  const canvas = new Canvas(Math.ceil(width), Math.ceil(height));

  const classListMock = {
    add: () => {},
    remove: () => {},
    contains: () => false,
    toggle: () => false,
  };

  const mockElement = (tag: string) => {
    if (tag === "canvas") {
      return Object.assign(canvas, {
        style: {},
        classList: classListMock,
        getBoundingClientRect: () => ({
          left: 0, top: 0, width, height, right: width, bottom: height,
        }),
        addEventListener: () => {},
        removeEventListener: () => {},
        parentNode: null,
        dispatchEvent: () => true,
        remove: () => {},
      }) as any;
    }
    return {
      style: {},
      classList: classListMock,
      appendChild: () => {},
      removeChild: () => {},
      insertBefore: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      setAttribute: () => {},
      getAttribute: () => null,
      textContent: "",
      childNodes: [],
      firstChild: null,
      append: () => {},
      remove: () => {},
    };
  };

  // Stub out browser globals that uPlot might touch during init.
  // uPlot checks typeof window at import time and uses window.addEventListener,
  // window.dispatchEvent, devicePixelRatio (global), and matchMedia (global).
  //
  // Instead of setting window = globalThis (which lacks DOM methods), we create
  // a minimal mock window object. Globals like devicePixelRatio and matchMedia
  // are also set on globalThis because uPlot accesses them as bare names.

  const mockMatchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });

  // @ts-ignore
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    devicePixelRatio: 1,
    matchMedia: mockMatchMedia,
    document: undefined as any,
    navigator: undefined as any,
  };

  // @ts-ignore
  globalThis.document = {
    createElement: mockElement,
    createTextNode: () => ({ textContent: "" }),
    createElementNS: () => mockElement("div"),
    documentElement: { style: {} },
    body: { appendChild: () => {}, style: {} },
    head: { appendChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  // @ts-ignore
  globalThis.DOMRect = class DOMRect {
    x: number;
    y: number;
    width: number;
    height: number;
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
    }
    toJSON() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
  } as any;
  // @ts-ignore
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // @ts-ignore
  globalThis.requestAnimationFrame = (fn: Function) => setTimeout(fn, 0);
  // @ts-ignore
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
  // @ts-ignore
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type: string, _init?: Record<string, any>) { super(type); }
  };
  // @ts-ignore
  globalThis.MouseEvent = class MouseEvent extends Event {
    constructor(type: string, _init?: Record<string, any>) { super(type); }
  };
  // @ts-ignore
  globalThis.TouchEvent = class TouchEvent extends Event {
    constructor(type: string, _init?: Record<string, any>) { super(type); }
  };
  // @ts-ignore
  globalThis.Path2D = Path2D;
  // @ts-ignore
  globalThis.HTMLElement = class HTMLElement {
    style: Record<string, string> = {};
    classList = classListMock;
    appendChild() {}
    addEventListener() {}
    removeEventListener() {}
  } as any;
  // @ts-ignore
  globalThis.KeyboardEvent = class KeyboardEvent extends Event {
    constructor(type: string, _init?: Record<string, any>) { super(type); }
  };
  // @ts-ignore
  globalThis.matchMedia = mockMatchMedia;
  // @ts-ignore
  globalThis.devicePixelRatio = 1;

  shimActive = true;
  return canvas;
}

function teardownDomShim() {
  // @ts-ignore
  delete globalThis.document;
  // @ts-ignore
  delete globalThis.window;
  // @ts-ignore
  delete globalThis.DOMRect;
  // @ts-ignore
  delete globalThis.ResizeObserver;
  // @ts-ignore
  delete globalThis.requestAnimationFrame;
  // @ts-ignore
  delete globalThis.cancelAnimationFrame;
  // @ts-ignore
  delete globalThis.CustomEvent;
  // @ts-ignore
  delete globalThis.MouseEvent;
  // @ts-ignore
  delete globalThis.TouchEvent;
  // @ts-ignore
  delete globalThis.Path2D;
  // @ts-ignore
  delete globalThis.HTMLElement;
  // @ts-ignore
  delete globalThis.KeyboardEvent;
  // @ts-ignore
  delete globalThis.matchMedia;
  // @ts-ignore
  delete globalThis.devicePixelRatio;
  shimActive = false;
}

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
  const canvas = setupDomShim(width, height);

  const { default: uPlot } = await import("uplot");

  const uplotPayload = options.payload;
  const { opts, data, rawData } = uplotPayload;

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
  // (see chart.js renderUplot: axes with scale "y" get formatPower, scale "%" get formatPrice).
  if (Array.isArray(uplotOpts.axes)) {
    uplotOpts.axes = uplotOpts.axes.map((axis) => {
      if (axis.scale === "y") {
        return { ...axis, values: (_u: uPlot, ticks: number[]) => ticks.map((v) => formatPower(v)) };
      }
      if (axis.scale === "%") {
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
  const chart = new uPlot(uplotOpts, data, (_self: uPlot, _init: Function) => { _init(); });

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
      teardownDomShim();
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
