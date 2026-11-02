import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(5).max(180).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  try {
    const source = await prisma.source.update({ where: { id }, data: parsed.data });
    return json({
      source: {
        id: source.id,
        enabled: source.enabled,
        name: source.name,
        intervalMinutes: source.intervalMinutes,
      },
    });
  } catch {
    return json({ error: "ไม่พบแหล่งข้อมูล" }, 404);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  await prisma.source.delete({ where: { id } }).catch(() => undefined);
  return json({ ok: true });
}
