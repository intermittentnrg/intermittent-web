import "dotenv/config";
import { isMainThread } from "node:worker_threads";
import {
  fetchEchartsPayload,
  renderEchartsVideo,
  type EchartsJsonPayload,
  type VideoProfile,
  type CreateFrameGenerator,
} from "./shared/renderEchartsVideo.ts";

type ElectricityMixProfile = {
  url: string;
  output: string;
  framerate: string;
  fps: string;
  windowHours: number;
  stepHours: number;
  title: string;
};

const profiles: Record<string, ElectricityMixProfile> = {
  de: {
    url: "/europe/country/DE/2025-10-01_to_2026-06-01/electricity_mix/echarts.json?production_type_groups=08_wind_offshore,09_wind_onshore,11_solar&transmission=0&load=1",
    output: "render/electricity-mix-de.mp4",
    framerate: "30",
    fps: "30",
    windowHours: 3*7*24,
    stepHours: 3,
    // Noto Color Emoji (available via fonts-noto-color-emoji in the Docker image) renders
    // the flag and emoji glyphs that DejaVu Sans doesn't cover.
    title: "🇩🇪 Germany Wind🌪️ and ☀️Solar - https://intermittent.energy powered by TimescaleDB",
  },
  gb: {
    url: "/europe/country/GB/7_days_ago_to_now/electricity_mix/echarts.json",
    output: "render/electricity-mix-gb.mp4",
    framerate: "30",
    fps: "30",
    windowHours: 24,
    stepHours: 1,
    title: "Great Britain - Electricity Mix - https://intermittent.energy powered by TimescaleDB",
  },
};

const profileName = process.env.RENDER_PROFILE || "de";
const baseProfile = profiles[profileName];
if (!baseProfile) {
  throw new Error(`Unknown RENDER_PROFILE=${profileName}. Expected one of: ${Object.keys(profiles).join(", ")}`);
}

const defaultWidth = 1200;
const defaultHeight = 675;
const profile: ElectricityMixProfile & VideoProfile = {
  ...baseProfile,
  width: Number(process.env.ELECTRICITY_MIX_WIDTH || defaultWidth),
  height: Number(process.env.ELECTRICITY_MIX_HEIGHT || defaultHeight),
  output: process.argv[2] || process.env.ELECTRICITY_MIX_VIDEO || baseProfile.output,
  url: process.argv[3] || process.env.ELECTRICITY_MIX_URL || baseProfile.url,
  framerate: process.env.ELECTRICITY_MIX_VIDEO_FRAMERATE || baseProfile.framerate,
  fps: process.env.ELECTRICITY_MIX_VIDEO_FPS || baseProfile.fps,
  windowHours: Number(process.env.ELECTRICITY_MIX_WINDOW_HOURS || baseProfile.windowHours),
  stepHours: Number(process.env.ELECTRICITY_MIX_STEP_HOURS || baseProfile.stepHours),
};

async function main() {
  const payload = await fetchEchartsPayload(profile.url);
  const baseOption = buildBaseTimelineOption(payload);

  const data0 = payload.options.series[0].data;
  const res = data0[1][0] - data0[0][0]; // ms per data point
  const stepPts = Math.round(profile.stepHours * 3600 * 1000 / res);
  const winPts = Math.round(profile.windowHours * 3600 * 1000 / res);
  const frameCount = Math.floor((data0.length - winPts) / stepPts) + 1;

  await renderEchartsVideo(
    profile,
    {
      payload, frameCount, baseOption,
      frameGeneratorModule: new URL("./renderElectricityMix.ts", import.meta.url).href,
      frameGeneratorParams: { stepHours: profile.stepHours, windowHours: profile.windowHours },
    },
    { description: "electricity mix frames" },
  );
}

function buildBaseTimelineOption(payload: EchartsJsonPayload) {
  const options = structuredClone(payload.options);
  options.animation = false;
  // Global fallback text size — explicit per-component overrides below still take precedence.
  options.textStyle = { ...(options.textStyle || {}), fontSize: 26 };
  // Wrap ☀️ in a rich-text span so only it uses Noto Color Emoji;
  // the rest stays in DejaVu Sans for proper Latin spacing.
  const richTitle = profile.title.replace(
    /☀️?/g,
    '{sun|☀}',
  );

  options.title = {
    ...(options.title || {}),
    text: richTitle,
    left: "center",
    top: 10,
    textStyle: {
      fontSize: 24,
      // DejaVu Sans first for normal Latin spacing.
      fontFamily: "'DejaVu Sans', 'Noto Color Emoji', sans-serif",
      rich: {
        sun: {
          // Noto first just for the sun glyph.
          fontFamily: "'Noto Color Emoji', 'DejaVu Sans', sans-serif",
        },
      },
    },
  };
  // Clear the original top:86% so bottom:5 actually takes effect.
  options.legend = { ...(options.legend || {}), top: undefined, bottom: 5, left: "center", itemWidth: 32, itemHeight: 18, textStyle: { fontSize: 32 } };
  // Disable auto-margin expansion so the chart area never shifts frame-to-frame.
  options.grid = { ...(options.grid || {}), top: 55, bottom: 75, left: 80, right: 0, outerBoundsMode: "none" };
  options.xAxis = mapAxis(options.xAxis, (axis) => ({
    ...axis,
    axisLabel: {
      ...(axis.axisLabel || {}),
      fontSize: 26,
      formatter: { type: "date" },
      hideOverlap: true,
    },
    splitLine: { show: true },
  }));

  // Compute global y-axis max across all series and pin the primary axis so
  // the range doesn't jitter frame-to-frame when data is clipped.
  const globalMax = computeMaxAcrossSeries(payload.options.series);
  options.yAxis = mapAxis(options.yAxis, (axis, index) => ({
    ...axis,
    max: index === 0 ? globalMax : axis.max,
    axisLabel: { ...(axis.axisLabel || {}), fontSize: 20 },
  }));

  delete options.dataZoom;
  return options;
}

/** Return the maximum numeric y-value across all series. */
function computeMaxAcrossSeries(series: any[]) {
  let globalMax = -Infinity;
  for (const s of series) {
    if (!s?.data) continue;
    for (const d of s.data) {
      const v = Array.isArray(d) ? d[1] : d;
      if (typeof v === "number" && v > globalMax) globalMax = v;
    }
  }
  return globalMax > 0 ? globalMax : 0;
}

function mapAxis(axis: any, mapper: (axis: Record<string, any>, index: number) => Record<string, any>) {
  const mapOne = (item: any, i: number) => typeof item === "object" && item !== null ? mapper(item, i) : item;
  return Array.isArray(axis) ? axis.map(mapOne) : mapOne(axis, 0);
}

// === Frame generator (used by workers via dynamic import) ===

export const createFrameGenerator: CreateFrameGenerator = (payload, params) => {
  const data0 = payload.options.series[0].data;
  const res = data0[1][0] - data0[0][0]; // ms per data point
  const stepPts = Math.round((params?.stepHours ?? 1) * 3600 * 1000 / res);
  const winPts = Math.round((params?.windowHours ?? 24) * 3600 * 1000 / res);
  const windowMs = data0[winPts - 1][0] - data0[0][0];
  const allSeries = payload.options.series;

  return (i: number) => {
    const start = i * stepPts;
    const end = Math.min(start + winPts, data0.length);
    return {
      series: allSeries.map((s: any) => ({ ...s, data: s.data.slice(start, end) })),
      xAxis: { min: data0[start][0], max: data0[start][0] + windowMs },
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
