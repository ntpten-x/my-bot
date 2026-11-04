import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { ReplyQueueError, openReplyItem, replyAdvanceInfo, replyTemplatesForPost } from "@/lib/reply-queue";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  try {
    const item = await openReplyItem(id);
    const [templates, info] = await Promise.all([replyTemplatesForPost(item.postId), replyAdvanceInfo()]);
    return json({ item: { ...item, templates }, prefs: info.prefs });
  } catch (err) {
    if (err instanceof ReplyQueueError) return json({ error: err.message, waitMs: err.waitMs }, err.status);
    throw err;
  }
}
