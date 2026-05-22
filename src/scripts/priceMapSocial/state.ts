import { querySmall } from "../../lib/db.ts";

export type SocialThreadReply = Record<string, unknown>;

type SocialThreadRow = {
  id: number;
  reply: SocialThreadReply | string | null;
};

export async function loadSocialThreadReply(id: number) {
  await ensureSocialThread(id);
  const rows = await querySmall<SocialThreadRow>("select id, reply from social_threads where id = $1", [id]);
  return parseReply(rows[0]?.reply);
}

export async function saveSocialThreadReply(id: number, reply: SocialThreadReply) {
  await querySmall(
    `insert into social_threads (id, reply)
     values ($1, $2::jsonb)
     on conflict (id) do update set reply = excluded.reply`,
    [id, JSON.stringify(reply)],
  );
}

async function ensureSocialThread(id: number) {
  await querySmall(
    `insert into social_threads (id)
     values ($1)
     on conflict (id) do nothing`,
    [id],
  );
}

function parseReply(reply: SocialThreadRow["reply"]) {
  if (!reply) return undefined;
  if (typeof reply === "string") return JSON.parse(reply) as SocialThreadReply;
  return reply;
}
