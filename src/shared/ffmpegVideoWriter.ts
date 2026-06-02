import { spawn, execSync } from "node:child_process";
import { unlinkSync } from "node:fs";
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

let fifoCounter = 0;

export function spawnFifoVideo(
  profile: VideoProfile,
  options: { renderMode: { ffmpegPreset: string } },
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

function ffmpegArgsForVideo(profile: VideoProfile, fifoPath: string, renderMode: { ffmpegPreset: string }) {
  return [
    "-hide_banner", "-loglevel", "warning", "-stats",
    "-f", "rawvideo", "-pixel_format", "rgba",
    "-video_size", `${profile.width}x${profile.height}`,
    "-framerate", profile.framerate,
    "-i", fifoPath,
    "-c:v", "libx264", "-preset", renderMode.ffmpegPreset,
    "-profile:v", "high", "-movflags", "+faststart",
    "-filter_complex", [
      `color=c=white:s=${profile.width}x${profile.height}:r=${profile.fps}[bg]`,
      "[bg][0:v]overlay=shortest=1",
      "pad=ceil(iw/2)*2:ceil(ih/2)*2",
      `fps=${profile.fps}`,
      "format=yuv420p",
    ].join(","),
    profile.output, "-y",
  ];
}
