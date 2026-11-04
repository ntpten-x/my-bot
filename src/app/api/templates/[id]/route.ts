import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { templateSchema } from "@/lib/automation-schema";

export const dynamic = "force-dynamic";

const patchSchema = templateSchema.partial();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const raw = await request.json().catch(() => null);
  if (raw && typeof raw === "object" && (raw as { used?: unknown }).used === true) {
    const template = await prisma.replyTemplate.update({ where: { id }, data: { useCount: { increment: 1 } } }).catch(() => null);
    return template ? json({ template }) : json({ error: "ไม่พบข้อความ" }, 404);
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const data = { ...parsed.data, ...(parsed.data.categoryId !== undefined ? { categoryId: parsed.data.categoryId || null } : {}) };
  const template = await prisma.replyTemplate.update({ where: { id }, data }).catch(() => null);
  return template ? json({ template }) : json({ error: "ไม่พบข้อความ" }, 404);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  // deleteMany: a missing record is a 404, not a logged Prisma P2025 error.
  const removed = await prisma.replyTemplate.deleteMany({ where: { id } });
  if (!removed.count) return json({ error: "ไม่พบรายการนี้ อาจถูกลบไปแล้ว" }, 404);
  await prisma.automationRule.updateMany({ where: { templateId: id }, data: { templateId: null } });
  return json({ ok: true });
}
