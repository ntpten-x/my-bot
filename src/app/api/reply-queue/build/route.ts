import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { buildReplyQueue } from "@/lib/reply-queue";

export const dynamic = "force-dynamic";

// Manual "build now": same rules as the scheduled build, without the Discord/LINE ping.
export async function POST() {
  const { error } = await authed();
  if (error) return error;
  return json(await buildReplyQueue({ notify: false }));
}
