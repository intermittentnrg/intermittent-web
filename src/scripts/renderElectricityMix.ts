import "dotenv/config";
import { isMainThread } from "node:worker_threads";
import { fetchPayload, renderVideo, type VideoProfile, type CreateFrameGenerator } from "./shared/renderVideo.ts";
import { renderUplotVideo } from "./shared/renderUplot.ts";

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
    url: "/europe/country/DE/2025-10-01_to_2026-06-01/electricity_mix.json?production_type_groups=08_wind_offshore,09_wind_onshore,11_solar&transmission=0&load=1",
    output: "render/electricity-mix-de.mp4",
    framerate: "30",
    fps: "30",
    windowHours: 3*7*24,
    stepHours: 3,
    title: "🇩🇪 Germany Wind🌪️ and ☀️Solar - https://intermittent.energy powered by TimescaleDB",
  },
  gb: {
    url: "/europe/country/GB/7_days_ago_to_now/electricity_mix.json",
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
  // Fetch the uPlot-native payload from the server
  const payload = await fetchPayload(profile.url);
  const { opts, data } = payload;

  // data is column-major: [timestamps[], val1[], val2[], ...]
  const timestamps: number[] = data?.[0] ?? [];
  const dataLen = timestamps.length;

  // Derive interval from the first two timestamps
  const interval = dataLen > 1 ? timestamps[1] - timestamps[0] : 0;
  if (interval === 0) throw new Error("Cannot determine interval from data");

  const stepPts = Math.round(profile.stepHours * 3600 / interval);
  const winPts = Math.round(profile.windowHours * 3600 / interval);
  const frameCount = Math.max(1, Math.floor((dataLen - winPts) / stepPts) + 1);

  // Build the base uPlot option with video-specific overrides.
  // This is spread on top of the server-provided opts.
  const baseOption = buildBaseUplotOption(payload);

  await renderUplotVideo(
    profile,
    {
      payload,
      frameCount,
      baseOption,
      frameGeneratorModule: new URL("./renderElectricityMix.ts", import.meta.url).href,
      frameGeneratorParams: { stepPts, winPts },
    },
    { description: "electricity mix frames" },
  );
}

function buildBaseUplotOption(
  uplotPayload: Record<string, any>,
): Record<string, any> {
  // Compute global y-axis max across all data columns for stable axis range
  const data = uplotPayload.data as (number | null)[][];
  const globalMax = computeGlobalMax(data);
  if (globalMax <= 0) return {};

  return {
    scales: {
      y: { range: [0, globalMax] },
    },
  };
}

function computeGlobalMax(data: (number | null)[][]): number {
  let max = -Infinity;
  if (!data || data.length < 2) return 0;
  for (let col = 1; col < data.length; col++) {
    const vals = data[col];
    for (let r = 0; r < vals.length; r++) {
      const v = vals[r];
      if (v != null && v > max) max = v;
    }
  }
  if (max <= 0) return 0;
  // Round up to a nice number
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / mag;
  if (norm <= 1) return mag;
  if (norm <= 2) return 2 * mag;
  if (norm <= 5) return 5 * mag;
  return 10 * mag;
}

// ── Frame generator (used by workers via dynamic import) ──

/**
 * Given the full columnar data [timestamps[], val1[], val2[], ..., valN[]],
 * return a per-frame data slice.
 */
export const createFrameGenerator: CreateFrameGenerator = (payload, params) => {
  const { stepPts, winPts } = params as Record<string, number>;
  const data = payload.data as (number | null)[][];
  const dataLen = data?.[0]?.length ?? 0;
  if (dataLen === 0) throw new Error("No data in payload");

  const rowCount = data.length; // number of columns including timestamps

  return (i: number) => {
    const start = i * stepPts;
    const end = Math.min(start + winPts, dataLen);
    const winLen = end - start;

    // Slice each column to the window range
    const sliced: (number | null)[][] = [];
    for (let col = 0; col < rowCount; col++) {
      sliced.push(data[col].slice(start, end));
    }

    return { data: sliced };
  };
};

// ── Entry point ──

if (isMainThread) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
