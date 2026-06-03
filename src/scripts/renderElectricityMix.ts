import "dotenv/config";
import {
  fetchEchartsPayload,
  renderEchartsVideo,
  type EchartsJsonPayload,
  type VideoProfile,
} from "../shared/renderEchartsVideo.ts";

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
    url: "/europe/country/DE/6_months_ago_to_now/electricity_mix/echarts.json?production_type_groups=08_wind_offshore,09_wind_onshore,11_solar&transmission=0&load=1",
    output: "render/electricity-mix-de.mp4",
    framerate: "30",
    fps: "30",
    windowHours: 3*7*24,
    stepHours: 3,
    // Note: emoji/flags need a font like Noto Color Emoji to render in video.
    // DejaVu Sans (default in textStyle) doesn't include emoji glyphs.
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
  // Compute step/window as data-point counts, pass them to the renderer
  // so it can slice the series array directly — no frame array needed.
  const data0 = payload.options.series[0].data;
  const res = data0[1][0] - data0[0][0]; // ms per data point
  const stepPts = Math.round(profile.stepHours * 3600 * 1000 / res);
  const winPts = Math.round(profile.windowHours * 3600 * 1000 / res);
  const frameCount = Math.floor((data0.length - winPts) / stepPts) + 1;
  await renderEchartsVideo(
    profile,
    { payload, stepPoints: stepPts, windowPoints: winPts, frameCount, baseOption },
    { description: "electricity mix frames" },
  );
}

function buildBaseTimelineOption(payload: EchartsJsonPayload) {
  const options = structuredClone(payload.options);
  options.animation = false;
  options.title = {
    ...(options.title || {}),
    text: profile.title,
    left: "center",
    top: 10,
    textStyle: { fontSize: 16 },
  };
  options.legend = { ...(options.legend || {}), bottom: 5, left: "center" };
  options.grid = { ...(options.grid || {}), top: 50, bottom: 80 };
  options.xAxis = mapAxis(options.xAxis, (axis) => ({
    ...axis,
    axisLabel: { ...(axis.axisLabel || {}), fontSize: 16 },
  }));
  options.yAxis = mapAxis(options.yAxis, (axis) => ({
    ...axis,
    axisLabel: { ...(axis.axisLabel || {}), fontSize: 16 },
  }));
  delete options.dataZoom;
  return options;
}

function mapAxis(axis: any, mapper: (axis: Record<string, any>) => Record<string, any>) {
  const mapOne = (item: any) => typeof item === "object" && item !== null ? mapper(item) : item;
  return Array.isArray(axis) ? axis.map(mapOne) : mapOne(axis);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
