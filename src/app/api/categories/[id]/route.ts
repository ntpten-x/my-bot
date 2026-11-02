import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  matchWords: z.string().max(500).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  try {
    const category = await prisma.category.update({
      where: { id },
      data: {
        name: parsed.data.name?.trim(),
        matchWords: parsed.data.matchWords?.trim(),
      },
    });
    return json({ category });
  } catch {
    return json({ error: "ไม่พบหมวด" }, 404);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const children = await prisma.category.count({ where: { parentId: id } });
  if (children) return json({ error: "ลบหมวดย่อยก่อน" }, 400);
  try {
    await prisma.category.delete({ where: { id } });
  } catch {
    return json({ error: "ลบหมวดนี้ไม่ได้" }, 400);
  }
  return json({ ok: true });
}
