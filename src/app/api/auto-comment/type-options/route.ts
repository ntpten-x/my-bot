import { authed } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { json } from "@/lib/http";
import { TYPE_SETUP_PREFIX, readTypeSetup } from "@/lib/auto-comment/type-setup";

export const dynamic = "force-dynamic";
export async function GET() {
  const { error } = await authed(); if (error) return error;
  const [categories, products, templates, sources, setups] = await Promise.all([
    prisma.category.findMany({ where: { parentId: null }, select: { id: true, slug: true, name: true } }),
    prisma.product.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, categorySlug: true, enabled: true } }),
    prisma.replyTemplate.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, body: true, categoryId: true, productId: true, sourceIds: true } }),
    prisma.source.findMany({ where: { type: "facebook_group" }, select: { id: true, name: true, enabled: true, boundCategorySlug: true, defaultProductId: true } }),
    prisma.setting.findMany({ where: { key: { startsWith: TYPE_SETUP_PREFIX } } }),
  ]);
  return json({ categories, products, templates, sources, setups: Object.fromEntries(setups.map(row => [row.key.slice(TYPE_SETUP_PREFIX.length), readTypeSetup(row.value)])) });
}
