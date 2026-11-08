import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
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
  try {
    const result = await prisma.$transaction(async (tx) => {
      const category = await tx.category.findUnique({ where: { id } });
      if (!category) return { error: "ไม่พบหมวดหมู่นี้", status: 404 };
      if (await tx.category.count({ where: { parentId: id } })) {
        return { error: "หมวดหมู่นี้มีหมวดย่อย กรุณาย้ายหรือลบหมวดย่อยในหน้า หมวดและคีย์เวิร์ด ก่อน", status: 400 };
      }
      if (await tx.product.count({ where: { categorySlug: category.slug } })) {
        return { error: "หมวดหมู่นี้มีประเภท กรุณาลบประเภทภายใต้หมวดหมู่ก่อน", status: 400 };
      }
      if (await tx.replyTemplate.count({ where: { categoryId: id } })) {
        return { error: "หมวดหมู่นี้มีชุดข้อความ กรุณาย้ายหรือลบข้อความในหน้า จัดการข้อความ ก่อน", status: 400 };
      }
      await tx.source.updateMany({ where: { boundCategorySlug: category.slug }, data: { boundCategorySlug: "" } });
      await tx.category.delete({ where: { id } });
      return null;
    });
    if (result) return json({ error: result.error }, result.status);
  } catch {
    return json({ error: "ลบหมวดหมู่นี้ไม่ได้ กรุณาลองอีกครั้ง" }, 400);
  }
  return json({ ok: true });
}
