import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Canvas } from "skia-canvas";
import { processEchartsFormatters } from "../../shared/echartsFormatters.ts";
import { getEchartsForSsr } from "../../dashboards/shared/echartsSsr.ts";
import type { TimelineRendererOptions, ChartRenderer, CreateFrameGenerator, FrameGenerator, RendererFactory } from "./renderVideo.ts";
import { renderVideo, type VideoProfile } from "./renderVideo.ts";

export type EchartsJsonPayload = {
  options: Record<string, any>;
  geoJsonUrl?: string;
  mapName?: string;
} & Record<string, any>;

// ---------------------------------------------------------------------------
// Renderer

export async function createEchartsRenderer(
  options: TimelineRendererOptions,
  getFramePayload?: FrameGenerator,
): Promise<ChartRenderer> {
  const echarts = await getEchartsForSsr();
  echarts.setPlatformAPI({ createCanvas: () => new Canvas(1, 1) });
  if ((options.payload as EchartsJsonPayload).mapName && (options.payload as EchartsJsonPayload).geoJsonUrl) {
    registerMap(echarts, (options.payload as EchartsJsonPayload).mapName!, (options.payload as EchartsJsonPayload).geoJsonUrl!);
  }

  const canvas = new Canvas(options.width, options.height);
  canvas.gpu = process.env.GPU_RENDERING === "true";
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
    backgroundColor: "#ffffff",
    textStyle: { fontFamily: "DejaVu Sans, 'Noto Color Emoji', sans-serif" },
    ...baseOption,
  } as never, true);

  // Dynamically import the frame generator module if not provided
  const fg: FrameGenerator = getFramePayload ?? await loadFrameGenerator(options);
  return {
    renderFrame(index: number) {
      (chart as any).setOption((fg(index) as any) as Record<string, any>, { replaceMerge: ["series"] });
      chart.renderToCanvas();
    },
    async flushFrame(path: string) {
      await canvas.toFile(path, { format: "raw" });
    },
    dispose() { chart.dispose() },
  };
}

async function loadFrameGenerator(options: TimelineRendererOptions): Promise<FrameGenerator> {
  const mod = await import(options.frameGeneratorModule) as { createFrameGenerator?: CreateFrameGenerator };
  if (!mod.createFrameGenerator) throw new Error(`Module ${options.frameGeneratorModule} does not export createFrameGenerator`);
  return mod.createFrameGenerator(options.payload, options.frameGeneratorParams);
}

function registerMap(echarts: any, mapName: string, geoJsonUrl: string) {
  if (echarts.getMap(mapName)) return;
  const p = join(process.cwd(), "public", geoJsonUrl.replace(/^\/+/, "").replace(/^assets\//, ""));
  echarts.registerMap(mapName, JSON.parse(readFileSync(p, "utf8")));
}

// ---------------------------------------------------------------------------
// Convenience wrapper

export async function renderEchartsVideo(
  profile: VideoProfile,
  rendererOptions: Omit<TimelineRendererOptions, "width" | "height">,
  options?: { description?: string },
) {
  await renderVideo(profile, rendererOptions, createEchartsRenderer as RendererFactory, options);
}
