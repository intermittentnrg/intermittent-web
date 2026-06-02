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
};

const profiles: Record<string, ElectricityMixProfile> = {
  de: {
    url: "/europe/country/DE/6_months_ago_to_now/electricity_mix/echarts.json?production_type_groups=08_wind_offshore,09_wind_onshore,11_solar&transmission=0&load=1",
    output: "render/electricity-mix-de.mp4",
    framerate: "30",
    fps: "30",
    windowHours: 3*7*24,
    stepHours: 3,
  },
  gb: {
    url: "/europe/country/GB/7_days_ago_to_now/electricity_mix/echarts.json",
    output: "render/electricity-mix-gb.mp4",
    framerate: "30",
    fps: "30",
    windowHours: 24,
    stepHours: 1,
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
  const frameOptions = buildSlidingWindowFrames(payload, profile.windowHours, profile.stepHours);
  const baseOption = buildBaseTimelineOption(payload);
  await renderEchartsVideo(
    profile,
    { payload, frameOptions, baseOption },
    { description: "electricity mix frames" },
  );
}

function buildSlidingWindowFrames(payload: EchartsJsonPayload, windowHours: number, stepHours: number) {
  const bounds = dataBounds(payload.options.series || []);
  const windowMs = windowHours * 60 * 60 * 1000;
  const stepMs = stepHours * 60 * 60 * 1000;
  const frames: Record<string, any>[] = [];

  for (let min = bounds.min; min + windowMs <= bounds.max; min += stepMs) {
    const max = min + windowMs;
    frames.push({
      title: {
        subtext: `${formatUtc(min)} – ${formatUtc(max)}`,
        subtextStyle: { fontSize: 18, fontWeight: "bold", color: "#555" },
      },
      xAxis: { min, max },
    });
  }

  // Ensure the final frame reaches "now" even when the source range is not an exact step multiple.
  const finalMin = bounds.max - windowMs;
  if (frames.length === 0 || frames.at(-1)?.xAxis?.min !== finalMin) {
    frames.push({
      title: {
        subtext: `${formatUtc(finalMin)} – ${formatUtc(bounds.max)}`,
        subtextStyle: { fontSize: 18, fontWeight: "bold", color: "#555" },
      },
      xAxis: { min: finalMin, max: bounds.max },
    });
  }

  return frames;
}

function buildBaseTimelineOption(payload: EchartsJsonPayload) {
  const options = structuredClone(payload.options);
  options.animation = false;
  options.title = {
    ...(options.title || {}),
    text: options.title?.text || "Electricity Mix",
    top: 14,
  };
  options.legend = { ...(options.legend || {}), top: 58 };
  options.grid = { ...(options.grid || {}), top: 105, bottom: 55 };
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

function dataBounds(series: any[]) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const item of series) {
    for (const point of item.data || []) {
      const time = Array.isArray(point) ? Number(point[0]) : Number.NaN;
      if (!Number.isNaN(time)) {
        min = Math.min(min, time);
        max = Math.max(max, time);
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error("No electricity mix data points returned");
  return { min, max };
}

function mapAxis(axis: any, mapper: (axis: Record<string, any>) => Record<string, any>) {
  const mapOne = (item: any) => typeof item === "object" && item !== null ? mapper(item) : item;
  return Array.isArray(axis) ? axis.map(mapOne) : mapOne(axis);
}

function formatUtc(value: number) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
