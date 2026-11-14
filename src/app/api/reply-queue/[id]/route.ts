import { readJson } from "@/lib/request-body";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { ReplyQueueError, editReplyItem, finishReplyItem, replyAdvanceInfo } from "@/lib/reply-queue";
import { replyItemActionSchema } from "@/lib/reply-queue-schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = replyItemActionSchema.safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  try {
    const body = parsed.data;
    if (body.action === "edit") return json({ ok: true, item: await editReplyItem(id, body.text) });
    await finishReplyItem(id, body.action, body.action === "sent" ? body.text : undefined);
    return json({ ok: true, advance: await replyAdvanceInfo() });
  } catch (err) {
    if (err instanceof ReplyQueueError) return json({ error: err.message }, err.status);
    throw err;
  }
}
