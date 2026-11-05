import { prisma } from "./prisma";
import { dominantHint, type GroupHint } from "./pipeline/group-profile";
import { loadGroupProducts } from "./products";

const DAY = 24 * 3600_000;

/** Dominant category per source over the last 30 days of AI/owner-labelled posts. */
export async function loadGroupHints(sourceIds: string[], now = Date.now()): Promise<Map<string, GroupHint>> {
  const ids = [...new Set(sourceIds)].filter(Boolean);
  const out = new Map<string, GroupHint>();
  if (!ids.length) return out;
  const [rows, cats] = await Promise.all([
    prisma.post.groupBy({
      by: ["sourceId", "categoryId"],
      where: { sourceId: { in: ids }, duplicateOfId: null, createdAt: { gte: new Date(now - 30 * DAY) }, aiProvider: { not: null } },
      _count: { _all: true },
    }),
    prisma.category.findMany({ where: { parentId: null }, select: { id: true, slug: true } }),
  ]);
  const slugOf = new Map(cats.map((row) => [row.id, row.slug]));
  const bySource = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const slug = (row.categoryId && slugOf.get(row.categoryId)) || "other";
    const counts = bySource.get(row.sourceId) ?? {};
    counts[slug] = (counts[slug] ?? 0) + row._count._all;
    bySource.set(row.sourceId, counts);
  }
  for (const [sourceId, counts] of bySource) {
    const hint = dominantHint(counts);
    if (hint) out.set(sourceId, hint);
  }
  // The owner's binding on the sources page beats the automatic profile.
  const [bound, products] = await Promise.all([
    prisma.source.findMany({ where: { id: { in: ids }, boundCategorySlug: { not: "" } }, select: { id: true, boundCategorySlug: true } }),
    loadGroupProducts(ids, now).catch(() => new Map()),
  ]);
  for (const source of bound) out.set(source.id, { categorySlug: source.boundCategorySlug, share: 1, total: Math.max(out.get(source.id)?.total ?? 0, 100) });
  for (const [sourceId, product] of products) {
    const hint = out.get(sourceId);
    if (hint) out.set(sourceId, { ...hint, productSlug: product.slug });
  }
  return out;
}
