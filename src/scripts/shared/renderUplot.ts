import { Canvas } from "skia-canvas";
import type { ChartRenderer, TimelineRendererOptions, FrameGenerator, RendererFactory } from "./renderVideo.ts";
import { renderVideo, type VideoProfile } from "./renderVideo.ts";

// ---------------------------------------------------------------------------
// Minimal DOM shim so uPlot can create its canvas and render headlessly.
// uPlot calls document.createElement('canvas') internally; we return a skia
// Canvas that it can draw to.

let shimActive = false;

function setupDomShim(width: number, height: number): Canvas {
  // Guard: only set up once per renderer instance
  if (shimActive) return null as any;

  const canvas = new Canvas(Math.ceil(width), Math.ceil(height));

  const mockElement = (tag: string) => {
    if (tag === "canvas") {
      return Object.assign(canvas, {
        style: {},
        getBoundingClientRect: () => ({
          left: 0, top: 0, width, height, right: width, bottom: height,
        }),
        addEventListener: () => {},
        removeEventListener: () => {},
        parentNode: null,
        dispatchEvent: () => true,
      }) as any;
    }
    return {
      style: {},
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
    };
  };

  // Stub out browser globals that uPlot might touch during init
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
  globalThis.window = globalThis;
  // @ts-ignore
  globalThis.DOMRect = class DOMRect {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
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
  globalThis.KeyboardEvent = class KeyboardEvent extends Event {
    constructor(type: string, _init?: Record<string, any>) { super(type); }
  };
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
  delete globalThis.KeyboardEvent;
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
  const { default: uPlot } = await import("uplot");

  const width = options.width;
  const height = options.height;

  // Set up DOM shim so uPlot renders to our skia canvas
  const canvas = setupDomShim(width, height);

  const uplotPayload = options.payload;
  const { opts, data, rawData } = uplotPayload;

  // Build initial uPlot configuration
  const uplotOpts: Record<string, any> = {
    ...opts,
    width,
    height,
    // Disable interactions for SSR
    cursor: { show: false },
    select: { show: false },
    legend: { show: false },
    // No plugins for SSR
    plugins: [],
  };

  // Create the uPlot instance — the DOM shim provides document
  const chart = new uPlot(uplotOpts as any, data, (globalThis as any).document.body);

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
