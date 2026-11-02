import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { aiQueueStats } from "@/lib/ai/stats";
import { enqueueUnclassifiedPosts } from "@/lib/ai/queue";

export const dynamic = "force-dynamic";
export async function GET() {
  const { error } = await authed();
  if (error) return error;
  return json(await aiQueueStats());
}
export async function POST() {
  const { error } = await authed();
  if (error) return error;
  return json({ queued: await enqueueUnclassifiedPosts(true) });
}
