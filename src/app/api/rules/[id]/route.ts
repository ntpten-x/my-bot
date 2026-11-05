import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { ruleData, ruleSchema } from "@/lib/automation-schema";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = ruleSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลกฎไม่ถูกต้อง" }, 400);
  const data = ruleData(parsed.data);
  const rule = await prisma.automationRule.update({ where: { id }, data }).catch(() => null);
  return rule ? json({ rule }) : json({ error: "ไม่พบกฎ" }, 404);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  // deleteMany: a missing record is a 404, not a logged Prisma P2025 error.
  const removed = await prisma.automationRule.deleteMany({ where: { id } });
  if (!removed.count) return json({ error: "ไม่พบรายการนี้ อาจถูกลบไปแล้ว" }, 404);
  return json({ ok: true });
}
