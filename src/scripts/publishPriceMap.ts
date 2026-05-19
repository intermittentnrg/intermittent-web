import "dotenv/config";
import { hasBskyConfig, publishToBsky, type BskyThreadState } from "./priceMapSocial/bsky";
import { loadSocialThreadReply, saveSocialThreadReply } from "./priceMapSocial/state";
import { hasXConfig, publishToX, type XThreadState } from "./priceMapSocial/x";

const videoPath = process.argv[2] || process.env.PRICE_MAP_VIDEO || "render/price-map.mp4";
const text = process.env.PRICE_MAP_POST_TEXT || defaultPostText();

const X_SOCIAL_THREAD_ID = 1;
const BSKY_SOCIAL_THREAD_ID = 2;

async function main() {
  const targets = (process.env.PRICE_MAP_POST_TARGETS || "x,bsky")
    .split(",")
    .map((target) => target.trim().toLowerCase())
    .filter(Boolean);

  if (targets.includes("x") || targets.includes("twitter")) {
    if (hasXConfig()) {
      const previous = (await loadSocialThreadReply(X_SOCIAL_THREAD_ID)) as XThreadState | undefined;
      const reply = await publishToX({ videoPath, text, previous });
      await saveSocialThreadReply(X_SOCIAL_THREAD_ID, reply);
    } else {
      console.log("Skipping X publish: TWITTER_* credentials are not configured.");
    }
  }

  if (targets.includes("bsky") || targets.includes("bluesky")) {
    if (hasBskyConfig()) {
      const previous = (await loadSocialThreadReply(BSKY_SOCIAL_THREAD_ID)) as BskyThreadState | undefined;
      const reply = await publishToBsky({ videoPath, text, previous });
      await saveSocialThreadReply(BSKY_SOCIAL_THREAD_ID, reply);
    } else {
      console.log("Skipping Bluesky publish: BLUESKY_USERNAME and BLUESKY_PASSWORD are not configured.");
    }
  }
}

function defaultPostText() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `Day ahead spot prices tomorrow ${tomorrow.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })} UTC`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
