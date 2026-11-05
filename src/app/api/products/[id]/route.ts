import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { clearProductCache } from "@/lib/products";
import { parseAliases } from "@/lib/pipeline/products";
import { serializeProduct } from "@/lib/product-admin";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  nameEn: z.string().trim().max(80).optional(),
  aliases: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const { aliases, ...rest } = parsed.data;
  try {
    const row = await prisma.product.update({ where: { id }, data: { ...rest, ...(aliases !== undefined ? { aliases: parseAliases(aliases).join(", ") } : {}) } });
    clearProductCache();
    if (aliases !== undefined || parsed.data.enabled !== undefined) {
      await prisma.post.updateMany({ where: { productBy: "none", createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } }, data: { productBy: "" } });
    }
    return json({ product: serializeProduct(row) });
  } catch {
    return json({ error: "ไม่พบเกม/สินค้านี้" }, 404);
  }
}
