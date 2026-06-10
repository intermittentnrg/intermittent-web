import "dotenv/config";
import { isMainThread } from "node:worker_threads";
import type { MapSeriesOption } from "echarts/types/dist/echarts";
import { processSeriesLabelFormatter } from "../shared/echartsFormatters.ts";
import { fetchPayload } from "./shared/renderVideo.ts";
import {
  renderEchartsVideo,
  type EchartsJsonPayload,
} from "./shared/renderEcharts.ts";
import type { VideoProfile, CreateFrameGenerator } from "./shared/renderVideo.ts";

type PriceMapProfile = {
  url: string;
  output: string;
  framerate: string;
  fps: string;
  aspectScale: number;
  mapZoom: number;
  mapCenter: [number, number];
  labelFormatter: string;
  geoJsonUrl?: string;
};

type PriceMapPayload = {
  options: {
    baseOption: Record<string, any>;
    options: Record<string, any>[];
  };
  geoJsonUrl?: string;
  mapName?: string;
};

const profiles: Record<string, PriceMapProfile> = {
  europe: {
    url: "/europe/country/all/tomorrow_to_tomorrow/price_map.json?resolution=15m",
    output: "render/price-map.mp4",
    framerate: "10",
    fps: "10",
    aspectScale: 0.75,
    mapZoom: 8.9,
    mapCenter: [6, 54],
    labelFormatter: "€{c}",
    geoJsonUrl: "/europe.geojson",
  },
  australia: {
    url: "/australia/region/all/tomorrow_to_tomorrow/price_map.json?resolution=5m",
    output: "render/price-map-australia.mp4",
    framerate: "15",
    fps: "15",
    aspectScale: 1,
    mapZoom: 9,
    mapCenter: [130, -25],
    labelFormatter: "${c}",
  },
  nukemap: {
    url: "/all/all/all/previous_month_to_previous_month/generation_of_peak_map.json?resolution=1h&production_type=nuclear",
    output: "render/nukemap.mp4",
    framerate: "30",
    fps: "30",
    aspectScale: 0.65,
    mapZoom: 1.4,
    mapCenter: [7, 10],
    labelFormatter: "{c}%",
  },
};

const profileName = process.env.RENDER_PROFILE || "europe";
const baseProfile = profiles[profileName];
if (!baseProfile) {
  throw new Error(`Unknown RENDER_PROFILE=${profileName}. Expected one of: ${Object.keys(profiles).join(", ")}`);
}

const defaultWidth = 1200;
const defaultHeight = 1200;
const profile: PriceMapProfile & VideoProfile = {
  ...baseProfile,
  width: Number(process.env.PRICE_MAP_WIDTH || defaultWidth),
  height: Number(process.env.PRICE_MAP_HEIGHT || defaultHeight),
  output: process.argv[2] || process.env.PRICE_MAP_VIDEO || baseProfile.output,
  url: process.argv[3] || process.env.PRICE_MAP_URL || baseProfile.url,
  framerate: process.env.PRICE_MAP_VIDEO_FRAMERATE || baseProfile.framerate,
  fps: process.env.PRICE_MAP_VIDEO_FPS || baseProfile.fps,
  aspectScale: Number(process.env.PRICE_MAP_ASPECT_SCALE || baseProfile.aspectScale),
  mapZoom: Number(process.env.PRICE_MAP_MAP_ZOOM || baseProfile.mapZoom),
  mapCenter: (process.env.PRICE_MAP_MAP_CENTER?.split(",").map(Number) || baseProfile.mapCenter) as [number, number],
};

const url = profile.url;
async function main() {
  const payload = await fetchPayload<PriceMapPayload>(url);
  const frames = payload.options.options;
  if (!frames?.length) {
    throw new Error(
      `No map frames returned for ${url}. ` +
        "Check that data has been imported for the requested date range, or pass an explicit URL: " +
        "npm run render:price-map -- render/output.mp4 /europe/all/all/2026-05-25_to_2026-05-25/price_map.json?resolution=15m",
    );
  }

  // Build chart config from baseOption (no timeline — each frame is applied
  // directly via setOption with its own { title, series } data).
  const baseOpt = structuredClone(payload.options.baseOption);
  baseOpt.animation = false;
  baseOpt.series = priceLabelMapSeries(baseOpt.series || []).map((item) => item.type === "map" ? {
    ...item,
    aspectScale: profile.aspectScale,
    center: profile.mapCenter,
    zoom: profile.mapZoom,
  } : item);
  delete (baseOpt as any).timeline;

  await renderEchartsVideo(
    profile,
    {
      payload: {
        ...payload,
        mapName: payload.mapName || "world",
        geoJsonUrl: profile.geoJsonUrl || payload.geoJsonUrl || "/world-rewound.geojson",
      },
      frameCount: frames.length,
      baseOption: baseOpt,
      frameGeneratorModule: new URL("./renderPriceMap.ts", import.meta.url).href,
    },
  );
}

function priceLabelMapSeries<T extends MapSeriesOption>(series: T[]) {
  return series.map((item) => item.type === "map" ? {
    ...item,
    label: {
      ...item.label,
      show: true,
      color: "#111111",
      fontFamily: "DejaVu Sans, 'Noto Color Emoji', sans-serif",
      fontSize: 18,
      fontWeight: "bold",
      textBorderColor: "#ffffff",
      textBorderWidth: 4,
      formatter: { type: "blank-invalid-template", template: profile.labelFormatter },
    },
  } : item);
}

// === Frame generator (used by workers via dynamic import) ===

export const createFrameGenerator: CreateFrameGenerator = (payload) => {
  const frames = (payload.options as any).options as Record<string, any>[];

  // Build full series configs from the original baseOption, applying the
  // same profile/label processing that main() applies to baseOpt.
  // The render loop uses replaceMerge: ["series"], so we must include series
  // in every frame payload — otherwise replaceMerge deletes them, leaving
  // a blank chart.
  const baseSeries = (payload.options as any).baseOption?.series as Record<string, any>[] | undefined;
  const seriesConfigs: Record<string, any>[] = [];
  if (Array.isArray(baseSeries)) {
    const processed = priceLabelMapSeries(baseSeries as MapSeriesOption[]).map((item) => item.type === "map" ? {
      ...item,
      data: undefined as undefined,
      aspectScale: profile.aspectScale,
      center: profile.mapCenter,
      zoom: profile.mapZoom,
    } : item);
    for (const s of processed) {
      if (s.type === "map") {
        const { data: _d, ...rest } = s;
        processSeriesLabelFormatter(rest.label);
        seriesConfigs.push(rest);
      } else {
        seriesConfigs.push(s);
      }
    }
  }

  return (i: number) => {
    const frame = frames[i];
    const frameSeries = Array.isArray(frame.series) ? frame.series : [];
    const mergedSeries = seriesConfigs.map((s, idx) => ({
      ...s,
      data: frameSeries[idx]?.data ?? s.data,
    }));
    return {
      ...frame,
      series: mergedSeries,
    };
  };
};

// === Entry point (main thread only) ===

if (isMainThread) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
