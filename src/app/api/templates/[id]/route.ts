import { readJson } from "@/lib/request-body";
import { templateScopeError } from "@/lib/template-scope";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { templateSchema } from "@/lib/automation-schema";
import { removeMessageImage, signedMessageImageUrl } from "@/lib/supabase-storage";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = templateSchema.partial().extend({
  clearImage: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const raw = await readJson(request, 1_500_000).catch(() => null);
  if (raw && typeof raw === "object" && (raw as { used?: unknown }).used === true) {
    const template = await prisma.replyTemplate.update({ where: { id }, data: { useCount: { increment: 1 } } }).catch(() => null);
    return template ? json({ template }) : json({ error: "ไม่พบข้อความ" }, 404);
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  if (parsed.data.categoryId !== undefined || parsed.data.productId !== undefined) {
    const current = await prisma.replyTemplate.findUnique({ where: { id }, select: { categoryId: true, productId: true } });
    if (!current) return json({ error: "ไม่พบข้อความ" }, 404);
    const scopeError = await templateScopeError(parsed.data.categoryId === undefined ? current.categoryId : parsed.data.categoryId, parsed.data.productId === undefined ? current.productId : parsed.data.productId);
    if (scopeError) return json({ error: scopeError }, 400);
  }
  const { sourceIds, clearImage, ...rest } = parsed.data;
  const existing = clearImage ? await prisma.replyTemplate.findUnique({ where: { id }, select: { imagePath: true } }) : null;
  if (clearImage && !existing) return json({ error: "ไม่พบข้อความ" }, 404);
  const data = {
    ...rest,
    ...(rest.categoryId !== undefined ? { categoryId: rest.categoryId || null } : {}),
    ...(rest.productId !== undefined ? { productId: rest.productId || null } : {}),
    ...(sourceIds !== undefined ? { sourceIds: sourceIds.join(",") } : {}),
    ...(clearImage ? { imagePath: null } : {}),
  };
  const template = await prisma.replyTemplate.update({ where: { id }, data }).catch(() => null);
  if (!template) return json({ error: "ไม่พบข้อความ" }, 404);
  if (clearImage && existing?.imagePath) await removeMessageImage(existing.imagePath).catch(() => undefined);
  const imageUrl = await signedMessageImageUrl(template.imagePath).catch(() => null);
  return json({ template: { ...template, imageUrl } });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const existing = await prisma.replyTemplate.findUnique({ where: { id }, select: { imagePath: true } });
  // deleteMany: a missing record is a 404, not a logged Prisma P2025 error.
  const removed = await prisma.replyTemplate.deleteMany({ where: { id } });
  if (!removed.count) return json({ error: "ไม่พบรายการนี้ อาจถูกลบไปแล้ว" }, 404);
  await prisma.automationRule.updateMany({ where: { templateId: id }, data: { templateId: null } });
  if (existing?.imagePath) await removeMessageImage(existing.imagePath).catch(() => undefined);
  return json({ ok: true });
}
