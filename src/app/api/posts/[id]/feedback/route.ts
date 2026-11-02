import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { postInclude, serializePost } from "@/lib/serialize";
import { recordFeedback } from "@/lib/smart/feedback";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = z
    .object({ action: z.enum(["dismiss", "save", "contacted", "closed_won", "closed_lost"]) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ไม่รู้จักการกระทำนี้" }, 400);
  try {
    await recordFeedback(id, parsed.data.action);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" }, 400);
  }
  const post = await prisma.post.findUnique({ where: { id }, include: postInclude });
  if (!post) return json({ error: "ไม่พบประกาศ" }, 404);
  return json({ post: serializePost(post) });
}
