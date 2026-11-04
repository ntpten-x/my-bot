import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { postInclude, serializePost, withAlsoIn } from "@/lib/serialize";
import { getSettings } from "@/lib/settings";
import { OPEN_STATUSES, followUpDate } from "@/lib/automation";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  isRead: z.boolean().optional(),
  isSaved: z.boolean().optional(),
  pipelineStatus: z.enum(["none", "following", "replied", "contacted", "closed_won", "closed_lost"]).optional(),
  categoryId: z.string().nullable().optional(),
  subcategoryId: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  followUpAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const { followUpAt, ...rest } = parsed.data;
  const data: Prisma.PostUpdateInput & typeof rest = { ...rest };
  const current = await prisma.post.findUnique({ where: { id }, select: { pipelineStatus: true } });
  if (!current) return json({ error: "ไม่พบประกาศ" }, 404);
  if (data.isSaved && !data.pipelineStatus && current.pipelineStatus === "none") data.pipelineStatus = "following";
  if (data.pipelineStatus && data.pipelineStatus !== "none") data.isSaved = true;
  if (data.pipelineStatus && data.pipelineStatus !== current.pipelineStatus) {
    data.statusChangedAt = new Date();
    // Open leads get a reminder; closed or cleared leads drop theirs.
    data.followUpAt = OPEN_STATUSES.includes(data.pipelineStatus) ? followUpDate((await getSettings()).followUpDays) : null;
  }
  // The owner pressed send in Facebook themselves; log it and close any queued draft for this post.
  if (data.pipelineStatus === "replied" && current.pipelineStatus !== "replied") {
    data.repliedAt = new Date();
    await prisma.replyQueueItem.updateMany({ where: { postId: id, status: { in: ["queued", "opened"] } }, data: { status: "sent", sentAt: new Date() } });
  }
  // The owner fixed the label by hand: AI never overwrites it and it becomes a prompt example.
  if (rest.categoryId !== undefined || rest.subcategoryId !== undefined) data.aiProvider = "owner";
  if (followUpAt !== undefined) data.followUpAt = followUpAt ? new Date(followUpAt) : null;
  try {
    const post = await prisma.post.update({ where: { id }, data: data as Prisma.PostUncheckedUpdateInput, include: postInclude });
    return json({ post: (await withAlsoIn([serializePost(post)]))[0] });
  } catch {
    return json({ error: "ไม่พบประกาศ" }, 404);
  }
}
