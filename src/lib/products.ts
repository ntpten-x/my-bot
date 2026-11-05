import { prisma } from "./prisma";
import { parseAliases, pickProduct, suggestGroupProduct, type ProductNode } from "./pipeline/products";

const DAY = 24 * 3600_000;
let cache: { at: number; rows: (ProductNode & { id: string })[] } | null = null;

export function clearProductCache() {
  cache = null;
}

export async function loadProducts(includeDisabled = false) {
  if (!cache || Date.now() - cache.at > 60_000) {
    const rows = await prisma.product.findMany({ orderBy: [{ categorySlug: "asc" }, { sortOrder: "asc" }, { name: "asc" }] });
    cache = {
      at: Date.now(),
      rows: rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, nameEn: row.nameEn, categorySlug: row.categorySlug, aliases: parseAliases(row.aliases), enabled: row.enabled })),
    };
  }
  return includeDisabled ? cache.rows : cache.rows.filter((row) => row.enabled !== false);
}

export type GroupProduct = { slug: string; share: number; total: number; manual: boolean };

/** Per source: the owner's default product, else the auto suggestion from the last 30 days of rule/AI/owner product labels. */
export async function loadGroupProducts(sourceIds?: string[], now = Date.now()): Promise<Map<string, GroupProduct>> {
  const ids = sourceIds ? [...new Set(sourceIds)].filter(Boolean) : undefined;
  const [sources, rows, products] = await Promise.all([
    prisma.source.findMany({ where: ids ? { id: { in: ids } } : {}, select: { id: true, defaultProductId: true } }),
    prisma.post.groupBy({
      by: ["sourceId", "productId"],
      where: {
        ...(ids ? { sourceId: { in: ids } } : {}),
        duplicateOfId: null,
        productId: { not: null },
        productBy: { in: ["rules", "ai", "owner"] },
        createdAt: { gte: new Date(now - 30 * DAY) },
      },
      _count: { _all: true },
    }),
    loadProducts(true),
  ]);
  const slugOf = new Map(products.map((row) => [row.id, row.slug]));
  const counts = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const slug = row.productId ? slugOf.get(row.productId) : undefined;
    if (!slug) continue;
    const entry = counts.get(row.sourceId) ?? {};
    entry[slug] = (entry[slug] ?? 0) + row._count._all;
    counts.set(row.sourceId, entry);
  }
  const out = new Map<string, GroupProduct>();
  for (const source of sources) {
    const manual = source.defaultProductId ? slugOf.get(source.defaultProductId) : undefined;
    if (manual) {
      out.set(source.id, { slug: manual, share: 1, total: 0, manual: true });
      continue;
    }
    const auto = suggestGroupProduct(counts.get(source.id) ?? {});
    if (auto) out.set(source.id, { ...auto, manual: false });
  }
  return out;
}

/**
 * Sets productId on the given posts: rules first, then the AI pick (if it is in the list), then the group default.
 * Owner choices are never overwritten. If the rules found a product while the post sat in "other"/no category,
 * the post moves to that product's category.
 */
export async function assignProducts(postIds: string[], aiSlugs: Map<string, string | null | undefined> = new Map()) {
  if (!postIds.length) return 0;
  const [posts, products, cats] = await Promise.all([
    prisma.post.findMany({
      where: { id: { in: postIds }, NOT: { productBy: "owner" } },
      select: { id: true, text: true, ocrText: true, sourceId: true, productId: true, productBy: true, aiProvider: true, category: { select: { slug: true } } },
    }),
    loadProducts(),
    prisma.category.findMany({ where: { parentId: null }, select: { id: true, slug: true } }),
  ]);
  if (!posts.length) return 0;
  const groups = await loadGroupProducts(posts.map((post) => post.sourceId));
  const idOf = new Map(products.map((row) => [row.slug, row.id]));
  const catOf = new Map(products.map((row) => [row.slug, row.categorySlug]));
  let changed = 0;
  for (const post of posts) {
    const categorySlug = post.category?.slug ?? null;
    const pick = pickProduct(
      { text: `${post.text}\n${post.ocrText}`, categorySlug, aiSlug: aiSlugs.get(post.id) ?? null, groupProduct: groups.get(post.sourceId)?.slug ?? null },
      products,
    );
    const productId = pick.slug ? (idOf.get(pick.slug) ?? null) : null;
    const moveCategory =
      pick.by === "rules" && pick.slug && (!categorySlug || categorySlug === "other") && post.aiProvider !== "owner"
        ? cats.find((row) => row.slug === catOf.get(pick.slug!))?.id
        : undefined;
    if (productId === post.productId && pick.by === post.productBy && !moveCategory) continue;
    await prisma.post.update({
      where: { id: post.id },
      data: { productId, productBy: pick.by, ...(moveCategory ? { categoryId: moveCategory, subcategoryId: null } : {}) },
    });
    changed += 1;
  }
  return changed;
}

/** Rules-only backfill of posts never checked for a product (productBy ""), a bounded batch per tick; no AI calls. */
export async function backfillProducts(limit = 300) {
  const rows = await prisma.post.findMany({ where: { productBy: "" }, select: { id: true }, orderBy: { createdAt: "desc" }, take: limit });
  if (!rows.length) return { checked: 0, changed: 0 };
  const changed = await assignProducts(rows.map((row) => row.id));
  // Posts the owner set stay "owner"; anything still unchecked (filtered out above) is marked so the batch moves on.
  await prisma.post.updateMany({ where: { id: { in: rows.map((row) => row.id) }, productBy: "" }, data: { productBy: "none" } });
  return { checked: rows.length, changed };
}
