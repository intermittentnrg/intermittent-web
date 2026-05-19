import { BskyAgent } from "@atproto/api";
import { readFile } from "node:fs/promises";

export type BskyRef = { uri: string; cid: string };
export type BskyThreadState = { root?: BskyRef; parent?: BskyRef };

export function hasBskyConfig() {
  return Boolean(process.env.BLUESKY_USERNAME && process.env.BLUESKY_PASSWORD);
}

export async function publishToBsky(options: { videoPath: string; text: string; previous?: BskyThreadState }) {
  const agent = new BskyAgent({ service: process.env.BLUESKY_PDS || "https://bsky.social" });
  await agent.login({ identifier: requiredEnv("BLUESKY_USERNAME"), password: requiredEnv("BLUESKY_PASSWORD") });

  console.log(`Uploading ${options.videoPath} to Bluesky...`);
  const video = await readFile(options.videoPath);
  const upload = await agent.uploadBlob(video, { encoding: "video/mp4" });

  const post = await agent.post({
    text: options.text,
    langs: ["en"],
    embed: {
      $type: "app.bsky.embed.video",
      video: upload.data.blob,
      aspectRatio: { width: 1074, height: 954 },
    },
    ...(options.previous?.parent
      ? { reply: { root: options.previous.root || options.previous.parent, parent: options.previous.parent } }
      : {}),
  });

  console.log(`Posted Bluesky record ${post.uri}`);
  return {
    root: options.previous?.root || { uri: post.uri, cid: post.cid },
    parent: { uri: post.uri, cid: post.cid },
  };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
