import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { clearProductCache } from "@/lib/products";
import { parseAliases } from "@/lib/pipeline/products";
import { productSlug, serializeProduct } from "@/lib/product-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const rows = await prisma.product.findMany({ orderBy: [{ categorySlug: "asc" }, { sortOrder: "asc" }, { name: "asc" }] });
  return json({ products: rows.map(serializeProduct) });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().max(80).optional(),
  categorySlug: z.string().min(1).max(60),
  aliases: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  if (!(await prisma.category.findFirst({ where: { slug: parsed.data.categorySlug, parentId: null } }))) return json({ error: "ไม่พบหมวดหลักนี้" }, 400);
  let slug = productSlug(parsed.data.nameEn || parsed.data.name);
  if (await prisma.product.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const max = await prisma.product.aggregate({ where: { categorySlug: parsed.data.categorySlug }, _max: { sortOrder: true } });
  const aliases = parseAliases(parsed.data.aliases ?? "");
  const row = await prisma.product.create({
    data: {
      slug,
      name: parsed.data.name,
      nameEn: parsed.data.nameEn ?? "",
      categorySlug: parsed.data.categorySlug,
      aliases: (aliases.length ? aliases : [parsed.data.name.toLowerCase()]).join(", "),
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  clearProductCache();
  // New aliases apply to older posts too: let the rules backfill look at "none" posts again.
  await prisma.post.updateMany({ where: { productBy: "none", createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } }, data: { productBy: "" } });
  return json({ product: serializeProduct(row) });
}
