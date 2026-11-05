import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { loadGroupHints } from "@/lib/group-profiles";
import { loadGroupProducts, loadProducts } from "@/lib/products";

export const dynamic = "force-dynamic";

/** Per group: the owner's binding and the automatic suggestion from the last 30 days. */
export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const sources = await prisma.source.findMany({ select: { id: true, boundCategorySlug: true, defaultProductId: true } });
  const ids = sources.map((source) => source.id);
  const [hints, products, list, coverage] = await Promise.all([
    loadGroupHints(ids),
    loadGroupProducts(ids),
    loadProducts(true),
    prisma.post.groupBy({
      by: ["sourceId"],
      where: { duplicateOfId: null, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) }, productId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const totals = await prisma.post.groupBy({
    by: ["sourceId"],
    where: { duplicateOfId: null, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } },
    _count: { _all: true },
  });
  const nameOf = new Map(list.map((row) => [row.slug, row.name]));
  return json({
    bindings: sources.map((source) => {
      const hint = hints.get(source.id);
      const product = products.get(source.id);
      const total = totals.find((row) => row.sourceId === source.id)?._count._all ?? 0;
      const withProduct = coverage.find((row) => row.sourceId === source.id)?._count._all ?? 0;
      return {
        sourceId: source.id,
        boundCategorySlug: source.boundCategorySlug,
        defaultProductId: source.defaultProductId,
        suggestedCategory: hint ? { slug: hint.categorySlug, share: hint.share } : null,
        suggestedProduct: product && !product.manual ? { slug: product.slug, name: nameOf.get(product.slug) ?? product.slug, share: product.share } : null,
        posts30d: total,
        productCoverage: total ? withProduct / total : 0,
      };
    }),
  });
}
