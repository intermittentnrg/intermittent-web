import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getEchartsForSsr } from "../dashboards/shared/echartsSsr.ts";
import { buildApp } from "../server.ts";

const width = Number(process.env.PRICE_MAP_WIDTH || 1200);
const height = Number(process.env.PRICE_MAP_HEIGHT || 1200);
const outDir = process.argv[2] || process.env.PRICE_MAP_RENDER_DIR || "render/price-map";
const dateRange = process.argv[3] || process.env.PRICE_MAP_DATE_RANGE || tomorrowDateRange();
const url = `/europe/region/europe/${dateRange}/price_map/echarts.json?resolution=15m`;

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
  if (process.env.PRICE_MAP_CLEAN !== "0" && existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });

  const app = await buildApp();
  try {
    const response = await app.inject({ method: "GET", url });
    if (response.statusCode !== 200) {
      throw new Error(`GET ${url} failed with ${response.statusCode}: ${response.body}`);
    }

    const payload = JSON.parse(response.body) as PriceMapPayload;
    const echarts = await getEchartsForSsr();
    registerMap(echarts, payload.mapName || "world", payload.geoJsonUrl || "/assets/world-rewound.geojson");

    const frameCount = payload.options.options.length;
    if (frameCount === 0) {
      throw new Error(
        `No price-map frames returned for ${dateRange}. ` +
          "The output directory was created, but there are no PNGs to write. " +
          "Check that prices have been imported for that date range, or pass an explicit range: " +
          "npm run render:price-map:frames -- render/price-map YYYY-MM-DD_to_YYYY-MM-DD",
      );
    }

    for (let i = 0; i < frameCount; i++) {
      const png = await renderFrame(payload, i);
      const timestamp = frameTimestamp(payload.frames[i]?.name);
      const filename = `${timestamp}.png`;
      const path = join(outDir, filename);
      writeFileSync(path, png);
      console.log(path);
    }
  } finally {
    await app.close();
  }
}

async function renderFrame(payload: PriceMapPayload, index: number) {
  const option = singleFrameOption(payload.options, index);
  const echarts = await getEchartsForSsr();
  echarts.setPlatformAPI({ createCanvas: () => createCanvas(1, 1) });
  const canvas = createCanvas(width, height);
  const chart = echarts.init(canvas, undefined, { renderer: "canvas", ssr: true, width, height });
  try {
    chart.setOption({
      backgroundColor: "#ffffff",
      textStyle: { fontFamily: "DejaVu Sans, sans-serif" },
      ...(option as Record<string, unknown>),
    } as never);
    return chart.renderToCanvas().toBuffer("image/png");
  } finally {
    chart.dispose();
  }
}

function singleFrameOption(options: PriceMapPayload["options"], index: number) {
  const base = structuredClone(options.baseOption);
  const frame = structuredClone(options.options[index] || {});

  delete base.timeline;
  base.title = { ...base.title, ...frame.title };
  base.series = (base.series || []).map((series: Record<string, any>, i: number) => ({
    ...series,
    ...(frame.series?.[i] || {}),
  }));

  return base;
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

function frameTimestamp(name: string | undefined) {
  const date = new Date(Number(name));
  if (Number.isNaN(date.getTime())) return "unknown-time";
  return date.toISOString().replace(/[:.]/g, "-");
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
