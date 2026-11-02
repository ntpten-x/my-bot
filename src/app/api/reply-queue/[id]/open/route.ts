import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { ReplyQueueError, openReplyItem } from "@/lib/reply-queue";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  try {
    return json({ item: await openReplyItem(id) });
  } catch (err) {
    if (err instanceof ReplyQueueError) return json({ error: err.message, waitMs: err.waitMs }, err.status);
    throw err;
  }
}
