import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { publicProvider } from "@/lib/ai/provider-registry";
import { providerData } from "@/lib/ai/provider-input";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  try {
    const data = providerData(body, true);
    // "พักใช้งานจนกว่า" can be cleared by hand so a provider returns right away.
    if (body.clearCooldown === true) Object.assign(data, { cooldownUntil: null, cooldownReason: null });
    const result = await prisma.aiProvider.updateMany({ where: { id }, data });
    if (!result.count) return json({ error: "ไม่พบผู้ให้บริการนี้" }, 404);
    const row = await prisma.aiProvider.findUniqueOrThrow({ where: { id } });
    return json({ provider: publicProvider(row) });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" }, 400);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const removed = await prisma.aiProvider.deleteMany({ where: { id } });
  if (!removed.count) return json({ error: "ไม่พบผู้ให้บริการนี้" }, 404);
  return json({ ok: true });
}