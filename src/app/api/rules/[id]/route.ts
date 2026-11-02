import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { ruleSchema } from "@/lib/automation-schema";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = ruleSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลกฎไม่ถูกต้อง" }, 400);
  const data = {
    ...parsed.data,
    ...(parsed.data.categoryId !== undefined ? { categoryId: parsed.data.categoryId || null } : {}),
    ...(parsed.data.templateId !== undefined ? { templateId: parsed.data.templateId || null } : {}),
  };
  const rule = await prisma.automationRule.update({ where: { id }, data }).catch(() => null);
  return rule ? json({ rule }) : json({ error: "ไม่พบกฎ" }, 404);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  await prisma.automationRule.delete({ where: { id } }).catch(() => null);
  return json({ ok: true });
}
