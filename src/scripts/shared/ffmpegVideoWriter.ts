import { spawn, execSync } from "node:child_process";
import { unlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

export type VideoProfile = {
  url: string;
  output: string;
  width: number;
  height: number;
  framerate: string;
  fps: string;
};

export type FifoVideo = {
  fifoPath: string;
  waitExit: () => Promise<number>;
  close: () => void;
};

// ---------------------------------------------------------------------------
// VAAPI detection — just check the DRM render node exists.
// On this PC (AMD RX590) that means the driver is ready.

let cachedDrmNode: string | undefined;

function drmRenderNode(): string | undefined {
  if (cachedDrmNode !== undefined) return cachedDrmNode;
  try {
    const devs = readdirSync("/dev/dri").filter((d) => d.startsWith("renderD"));
    cachedDrmNode = devs.length ? `/dev/dri/${devs[0]}` : undefined;
    return cachedDrmNode;
  } catch { return cachedDrmNode = undefined; }
}

// ---------------------------------------------------------------------------
// FIFO video

let fifoCounter = 0;

export function spawnFifoVideo(
  profile: VideoProfile,
  options: { renderMode: string },
): FifoVideo {
  const fifoPath = `${tmpdir()}/render-${process.pid}-${++fifoCounter}.fifo`;
  try { unlinkSync(fifoPath); } catch {}
  execSync(`mkfifo -m 644 "${fifoPath}"`, { stdio: "ignore" });

  console.log(`Rendering to FIFO at ${fifoPath}`);
  const ffmpegArgs = ffmpegArgsForVideo(profile, fifoPath, options.renderMode);
  console.log(`ffmpeg ${ffmpegArgs.join(" ")}`);
  const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: "inherit" });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { unlinkSync(fifoPath); } catch {}
  };

  return {
    fifoPath,
    close: cleanup,
    waitExit: () => new Promise<number>((resolve, reject) => {
      ffmpeg.on("error", (err) => { cleanup(); reject(err); });
      ffmpeg.on("exit", (code) => { cleanup(); resolve(code ?? 1); });
    }),
  };
}

// ---------------------------------------------------------------------------
// ffmpeg argument builders

function ffmpegArgsForVideo(profile: VideoProfile, fifoPath: string, renderMode: string) {
  const base = [
    "-f", "rawvideo", "-pixel_format", "rgba",
    "-video_size", `${profile.width}x${profile.height}`,
    "-framerate", profile.framerate,
    "-i", fifoPath,
  ];

  switch (renderMode) {
    case "fast":
    case "single": {
      const drmNode = drmRenderNode();
      const whiteBg = [
        `color=c=white:s=${profile.width}x${profile.height}:r=${profile.fps}[bg]`,
        "[bg][0:v]overlay=shortest=1",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
      ];
      if (drmNode) {
        console.log(`RENDER_MODE=${renderMode} → HW encoder: VAAPI via ${drmNode}`);
        return [
          "-hide_banner", "-loglevel", "error", "-stats",
          ...base,
          "-filter_complex", [...whiteBg, "format=nv12,hwupload[out]"].join(","),
          "-map", "[out]",
          "-c:v", "h264_vaapi",
          "-vaapi_device", drmNode,
          "-rc_mode", "CQP",
          "-qp", "35",
          "-profile:v", "high",
          profile.output, "-y",
        ];
      }
      console.log(`RENDER_MODE=${renderMode}: no GPU, falling back to software ultrafast.`);
      return [
        "-hide_banner", "-loglevel", "warning", "-stats",
        ...base,
        "-filter_complex", [...whiteBg, "format=yuv420p[out]"].join(","),
        "-map", "[out]",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "28",
        "-profile:v", "baseline",
        "-tune", "zerolatency",
        profile.output, "-y",
      ];
    }

    case "slow": {
      console.log(`RENDER_MODE=slow → SW encoder: libx264 veryslow`);
      return [
        "-hide_banner", "-loglevel", "warning", "-stats",
        ...base,
        "-c:v", "libx264",
        "-preset", "veryslow",
        "-crf", "18",
        "-profile:v", "high",
        "-movflags", "+faststart",
        "-filter_complex", [
          `color=c=white:s=${profile.width}x${profile.height}:r=${profile.fps}[bg]`,
          "[bg][0:v]overlay=shortest=1",
          "pad=ceil(iw/2)*2:ceil(ih/2)*2",
          `fps=${profile.fps}`,
          "format=yuv420p[out]",
        ].join(","),
        "-map", "[out]",
        profile.output, "-y",
      ];
    }

    default:
      throw new Error(`Unknown RENDER_MODE=${renderMode}. Expected fast, slow, or single.`);
  }
}
