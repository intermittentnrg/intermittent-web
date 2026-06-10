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
    url: "/europe/country/DE/2025-10-01_to_2026-06-01/electricity_mix.json?production_type_groups=08_wind_offshore,09_wind_onshore,11_solar&transmission=0&load=1",
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
  const payload = await fetchEchartsPayload(profile.url);
  const { startTime, interval } = payload.options;
  const series = payload.options.series;

  if (startTime == null || interval == null) {
    throw new Error("Payload options missing startTime/interval");
  }

  // API response now carries a 2D dataset (from applyTimeAxis), so dataLen
  // comes from the dataset source, not from per-series data arrays.
  const dataLen = payload.options.dataset?.source?.length ?? 0;

  const stepPts = Math.round(profile.stepHours * 3600 * 1000 / interval);
  const winPts = Math.round(profile.windowHours * 3600 * 1000 / interval);
  const frameCount = Math.max(1, Math.floor((dataLen - winPts) / stepPts) + 1);

  const baseOption = buildBaseTimelineOption(payload, startTime, interval, dataLen);

  await renderEchartsVideo(
    profile,
    {
      payload, frameCount, baseOption,
      frameGeneratorModule: new URL("./renderElectricityMix.ts", import.meta.url).href,
      frameGeneratorParams: { stepPts, winPts, startTime, interval },
    },
    { description: "electricity mix frames" },
  );
}

function buildBaseTimelineOption(
  payload: EchartsJsonPayload,
  startTime: number,
  interval: number,
  dataLen: number,
) {
  const options = structuredClone(payload.options);
  options.animation = false;
  // No data-point symbols needed for video rendering — and more importantly
  // SymbolDraw.updateData unconditionally runs data.diff() which is ~8% CPU.
  options.showSymbol = false;
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

  // The API response already carries the 2D dataset (built by applyTimeAxis on
  // the server), so the base option inherits it as-is.  The frame generator will
  // slice this same table for each frame.

  // Use a time axis so ECharts picks nice intervals (midnight, etc.) and scrolls
  // the labels / split-lines naturally when the dataset source changes.
  options.xAxis = mapAxis(options.xAxis, (axis) => ({
    ...axis,
    type: "time",
    data: undefined,
    axisLabel: {
      ...(axis.axisLabel || {}),
      fontSize: 26,
      hideOverlap: true,
    },
    splitLine: { show: true },
  }));

  // Series already carry encode (not raw data) from the API response.
  // Nothing to do here — the dataset is the single source of truth.

  // Compute global y-axis max from the dataset and pin the primary axis so
  // the range doesn't jitter frame-to-frame when data is clipped.
  const globalMax = computeMaxAcrossDataset(payload.options.dataset?.source);
  options.yAxis = mapAxis(options.yAxis, (axis, index) => ({
    ...axis,
    max: index === 0 ? globalMax : axis.max,
    axisLabel: { ...(axis.axisLabel || {}), fontSize: 20 },
  }));

  delete options.dataZoom;
  return options;
}

/** Return the maximum numeric y-value across the dataset (column 1..N), rounded
 *  up to a nice round number so ECharts picks clean tick intervals. */
function computeMaxAcrossDataset(source: unknown[][] | undefined) {
  if (!source?.length) return 0;
  let globalMax = -Infinity;
  for (const row of source) {
    for (let col = 1; col < row.length; col++) {
      const v = Number(row[col]);
      if (!isNaN(v) && v > globalMax) globalMax = v;
    }
  }
  if (globalMax <= 0) return 0;
  // Round up to the nearest nice number (1, 2, or 5 × power of 10)
  const mag = Math.pow(10, Math.floor(Math.log10(globalMax)));
  const norm = globalMax / mag;
  if (norm <= 1) return mag;
  if (norm <= 2) return 2 * mag;
  if (norm <= 5) return 5 * mag;
  return 10 * mag;
}

function mapAxis(axis: any, mapper: (axis: Record<string, any>, index: number) => Record<string, any>) {
  const mapOne = (item: any, i: number) => typeof item === "object" && item !== null ? mapper(item, i) : item;
  return Array.isArray(axis) ? axis.map(mapOne) : mapOne(axis, 0);
}

// === Frame generator (used by workers via dynamic import) ===

/** Mark an object as "primitive" to prevent zrender's clone from deep-copying it.
 *  ECharts/zrender checks for the `__ec_primitive__` property and skips cloning
 *  when it is truthy. */
function markPrimitive<T extends object>(obj: T): T {
  (obj as Record<string, any>)["__ec_primitive__"] = true;
  return obj;
}

/** Pre-allocate a flat Float64Array containing ALL data columns
 *  (row-major: [t, v1, v2, …, t, v1, v2, …]).  ECharts accepts flat typed arrays
 *  as dataset source when dimensions are provided, and uses the fast
 *  `fillStorageForTypedArray` path which avoids per-row getter calls.
 *
 *  Returns the flat array and dimension definitions. */
function buildFlatTypedStore(source: unknown[][]) {
  const dataLen = source.length;
  const colCount = source[0]?.length ?? 0;
  if (colCount < 2) throw new Error("Expected at least 2 columns");

  // Use Float64Array for all columns (timestamps need Float64; value columns
  // are Int32-range but Float64 is fine and keeps a single unified buffer).
  const flat = new Float64Array(dataLen * colCount);
  for (let r = 0; r < dataLen; r++) {
    const row = source[r];
    const base = r * colCount;
    for (let c = 0; c < colCount; c++) {
      flat[base + c] = row[c];
    }
  }
  return flat;
}

/** Build dimension definitions from the series names. */
function buildDimDefs(series: unknown[]) {
  const names = series.map((s: any) => s.name ?? "");
  return [
    { name: "time", type: "time" as const },
    ...names.map((n: string) => ({ name: n, type: "int" as const })),
  ];
}

export const createFrameGenerator: CreateFrameGenerator = (payload, params) => {
  const { stepPts, winPts } = params as Record<string, number>;
  const source = payload.options.dataset?.source as unknown[][] | undefined;
  const dataLen = source?.length ?? 0;
  const colCount = source?.[0]?.length ?? 0;

  // Pre-build series configs (encode points to the dataset).
  // The render loop uses replaceMerge: ["series"], so we must include series
  // in every frame payload — otherwise replaceMerge would delete them.
  const allSeries = payload.options.series;
  const seriesConfigs = Array.isArray(allSeries)
    ? allSeries.map((s: any) => {
        const { data: _drop, ...rest } = s;
        // showSymbol must be explicitly false per series — the global option
        // does not cascade to series models for this property.
        rest.showSymbol = false;
        return rest;
      })
    : [];

  // Convert the 2-D array source to a flat Float64Array.
  // Mark it primitive so zrender's clone returns it as-is (zero copy).
  const flatFull = markPrimitive(buildFlatTypedStore(source!));
  const dimDefs = buildDimDefs(allSeries);

  return (i: number) => {
    const start = i * stepPts;
    const end = Math.min(start + winPts, dataLen);
    const winLen = end - start;

    // Zero-copy subarray view into the shared ArrayBuffer.
    // Float64: 8 bytes per element.
    const byteOffset = flatFull.byteOffset + start * colCount * 8;
    const sliced = new Float64Array(
      flatFull.buffer,
      byteOffset,
      winLen * colCount,
    );
    markPrimitive(sliced);

    return {
      dataset: {
        source: sliced,
        dimensions: dimDefs,
      },
      series: seriesConfigs,
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
