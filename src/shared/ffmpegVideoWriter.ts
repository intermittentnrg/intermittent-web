import { spawn } from "node:child_process";

export type VideoProfile = {
  url: string;
  output: string;
  width: number;
  height: number;
  framerate: string;
  fps: string;
};

export type FrameSource = {
  frame(index: number): Promise<Buffer> | Buffer;
  close(): Promise<void> | void;
};

export async function renderFrameSourceToVideo(
  profile: VideoProfile,
  frameCount: number,
  frames: FrameSource,
  options: { description?: string; renderMode: { ffmpegPreset: string } },
) {
  const ffmpegArgs = ffmpegArgsForVideo(profile, options.renderMode);
  console.log(`ffmpeg ${ffmpegArgs.join(" ")}`);
  console.log(`Rendering ${frameCount} ${options.description || "frames"}`);

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "inherit", "inherit"] });

  try {
    for (let i = 0; i < frameCount; i++) {
      await writeAll(ffmpeg.stdin, await frames.frame(i));
    }
    ffmpeg.stdin.end();
  } catch (error) {
    ffmpeg.stdin.destroy(error as Error);
    throw error;
  } finally {
    await frames.close();
  }

  const status = await new Promise<number>((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("exit", (code) => resolve(code ?? 1));
  });
  if (status !== 0) throw new Error(`ffmpeg exited with code ${status}`);
}

function ffmpegArgsForVideo(profile: VideoProfile, renderMode: { ffmpegPreset: string }) {
  const ffmpegPresetArgs = ["-preset", renderMode.ffmpegPreset];
  return [
    "-hide_banner",
    "-loglevel", "warning",
    "-stats",
    "-f", "rawvideo",
    "-pixel_format", "rgba",
    "-video_size", `${profile.width}x${profile.height}`,
    "-framerate", profile.framerate,
    "-i", "pipe:0",
    "-c:v", "libx264",
    ...ffmpegPresetArgs,
    "-profile:v", "high",
    "-movflags", "+faststart",
    "-filter_complex", [
      `color=c=white:s=${profile.width}x${profile.height}:r=${profile.fps}[bg]`,
      "[bg][0:v]overlay=shortest=1",
      "pad=ceil(iw/2)*2:ceil(ih/2)*2",
      `fps=${profile.fps}`,
      "format=yuv420p",
    ].join(","),
    profile.output,
    "-y",
  ];
}

function writeAll(stream: NodeJS.WritableStream, chunk: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("error", onError);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    stream.on("error", onError);
    if (stream.write(chunk)) { cleanup(); resolve(); } else stream.on("drain", onDrain);
  });
}
