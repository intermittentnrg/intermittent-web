import "dotenv/config";
import { spawnSync } from "node:child_process";

const frameDir = process.argv[2] || process.env.PRICE_MAP_RENDER_DIR || "render/price-map";
const output = process.argv[3] || process.env.PRICE_MAP_VIDEO || "render/price-map.mp4";
const input = `${frameDir}/*.png`;
const framerate = process.env.PRICE_MAP_VIDEO_FRAMERATE || "10";
const fps = process.env.PRICE_MAP_VIDEO_FPS || "10";

const vf = [
  "pad=ceil(iw/2)*2:ceil(ih/2)*2",
  `fps=${fps}`,
  "format=yuv420p",
].join(",");

const args = [
  "-framerate",
  framerate,
  "-pattern_type",
  "glob",
  "-i",
  input,
  "-c:v",
  "libx264",
  "-preset",
  "veryslow",
  "-profile:v",
  "high",
  "-movflags",
  "+faststart",
  "-vf",
  vf,
  output,
  "-y",
];

console.log(`ffmpeg ${args.map(shellQuote).join(" ")}`);
const result = spawnSync("ffmpeg", args, { stdio: "inherit" });
process.exit(result.status ?? 1);

function shellQuote(value: string) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}
