import { Client, OAuth1 } from "@xdevplatform/xdk";
import { readFile, stat } from "node:fs/promises";

export type XThreadState = { in_reply_to_tweet_id?: string };

export function hasXConfig() {
  return Boolean(
    process.env.TWITTER_API_KEY &&
      process.env.TWITTER_API_KEY_SECRET &&
      process.env.TWITTER_ACCESS_TOKEN &&
      process.env.TWITTER_ACCESS_TOKEN_SECRET,
  );
}

export async function publishToX(options: { videoPath: string; text: string; previous?: XThreadState }) {
  const client = new Client({
    oauth1: new OAuth1({
      apiKey: requiredEnv("TWITTER_API_KEY"),
      apiSecret: requiredEnv("TWITTER_API_KEY_SECRET"),
      callback: "oob",
      accessToken: requiredEnv("TWITTER_ACCESS_TOKEN"),
      accessTokenSecret: requiredEnv("TWITTER_ACCESS_TOKEN_SECRET"),
    }),
  });

  console.log(`Uploading ${options.videoPath} to X...`);
  const mediaId = await uploadXVideo(client, options.videoPath);

  const tweet = await client.posts.create({
    text: options.text,
    media: { media_ids: [mediaId] },
    ...(options.previous?.in_reply_to_tweet_id
      ? { reply: { in_reply_to_tweet_id: options.previous.in_reply_to_tweet_id } }
      : {}),
  });

  const tweetId = tweet.data?.id;
  if (!tweetId) throw new Error(`X did not return a tweet id: ${JSON.stringify(tweet)}`);
  console.log(`Posted X tweet ${tweetId}`);

  // @xdevplatform/xdk does not currently expose retweet helpers as conveniently as the old Rails x gem.
  // Keep thread state so the next post replies to this one; skip retweet maintenance for now.
  return { in_reply_to_tweet_id: tweetId };
}

async function uploadXVideo(client: Client, videoPath: string) {
  const bytes = await readFile(videoPath);
  const { size } = await stat(videoPath);
  const init = await client.media.initializeUpload({
    body: { totalBytes: size, mediaType: "video/mp4", mediaCategory: "tweet_video" },
  });
  const mediaId = extractXMediaId(init);
  const chunkSize = Number(process.env.X_MEDIA_CHUNK_SIZE || 4 * 1024 * 1024);

  for (let offset = 0, segmentIndex = 0; offset < bytes.length; offset += chunkSize, segmentIndex += 1) {
    await client.media.appendUpload(mediaId, {
      body: {
        segmentIndex,
        media: bytes.subarray(offset, offset + chunkSize).toString("base64"),
      },
    });
    console.log(`Uploaded X media segment ${segmentIndex}`);
  }

  const finalized = await client.media.finalizeUpload(mediaId);
  let processingInfo = getXProcessingInfo(finalized);
  while (processingInfo && processingInfo.state !== "succeeded") {
    if (processingInfo.state === "failed") throw new Error(`X media processing failed: ${JSON.stringify(processingInfo)}`);
    await sleep(Number(processingInfo.check_after_secs || processingInfo.checkAfterSecs || 2) * 1000);
    const status = await client.media.getUploadStatus(mediaId, { command: "STATUS" });
    processingInfo = getXProcessingInfo(status);
  }

  return mediaId;
}

function extractXMediaId(response: unknown) {
  const data = (response as { data?: Record<string, unknown> }).data || (response as Record<string, unknown>);
  const mediaId = data.id || data.media_id || data.mediaId || data.media_key || data.mediaKey;
  if (!mediaId) throw new Error(`X media upload did not return an id: ${JSON.stringify(response)}`);
  return String(mediaId);
}

function getXProcessingInfo(response: unknown) {
  const data = (response as { data?: Record<string, unknown> }).data || (response as Record<string, unknown>);
  return (data.processing_info || data.processingInfo) as
    | { state?: string; check_after_secs?: number; checkAfterSecs?: number }
    | undefined;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
