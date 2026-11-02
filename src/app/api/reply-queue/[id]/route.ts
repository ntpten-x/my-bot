import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { ReplyQueueError, finishReplyItem } from "@/lib/reply-queue";

export const dynamic = "force-dynamic";

const schema = z.object({ action: z.enum(["sent", "skip"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  try {
    await finishReplyItem(id, parsed.data.action);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof ReplyQueueError) return json({ error: err.message }, err.status);
    throw err;
  }
}
