import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { postInclude, serializePost } from "@/lib/serialize";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  isRead: z.boolean().optional(),
  isSaved: z.boolean().optional(),
  pipelineStatus: z.enum(["none", "following", "contacted", "closed_won", "closed_lost"]).optional(),
  categoryId: z.string().nullable().optional(),
  subcategoryId: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const data = { ...parsed.data };
  if (data.isSaved && !data.pipelineStatus) {
    const current = await prisma.post.findUnique({ where: { id } });
    if (current?.pipelineStatus === "none") data.pipelineStatus = "following";
  }
  if (data.pipelineStatus && data.pipelineStatus !== "none") data.isSaved = true;
  try {
    const post = await prisma.post.update({ where: { id }, data, include: postInclude });
    return json({ post: serializePost(post) });
  } catch {
    return json({ error: "ไม่พบประกาศ" }, 404);
  }
}
