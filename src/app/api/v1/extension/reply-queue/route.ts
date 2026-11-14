import { readJson } from "@/lib/request-body";
import { facebookWorkAllowed } from "@/lib/facebook-accounts";
import { requireExtensionToken } from "@/lib/auth";
import { corsPreflight, json, withCors } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { ReplyQueueError, finishReplyItem, markPostReplied, openNextReplyItem, replyAdvanceInfo } from "@/lib/reply-queue";
import { extensionReplySchema } from "@/lib/reply-queue-schema";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

// Used by the extension's overlay on the Facebook tab. It only records what the owner did
// ("sent" after they pressed Facebook's own send button, or "skip") and opens the next queued lead.
export async function POST(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization"), request))) {
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  const parsed = extensionReplySchema.safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return withCors(json({ error: "ข้อมูลไม่ถูกต้อง" }, 400));
  const body = parsed.data;
  try {
    if (body.op === "status") return withCors(json({ advance: await replyAdvanceInfo() }));
    if (body.op === "next") {
      if (!(await facebookWorkAllowed(request))) return withCors(json({ item: null, accountPaused: true }));
      const { item, ...advance } = await openNextReplyItem();
      return withCors(json({ item, advance }));
    }
    if (body.itemId) {
      await finishReplyItem(body.itemId, body.action, body.action === "sent" ? body.text : undefined);
    } else if (body.postId) {
      if (body.action === "sent") {
        const exists = await prisma.post.findUnique({ where: { id: body.postId }, select: { id: true } });
        if (!exists) return withCors(json({ error: "ไม่พบโพสต์" }, 404));
        await markPostReplied(body.postId);
      }
    } else {
      return withCors(json({ error: "ไม่ระบุรายการ" }, 400));
    }
    return withCors(json({ ok: true, queued: Boolean(body.itemId), advance: await replyAdvanceInfo() }));
  } catch (err) {
    if (err instanceof ReplyQueueError) return withCors(json({ error: err.message }, err.status));
    throw err;
  }
}
