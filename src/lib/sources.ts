import { prisma } from "./prisma";
import { canonicalSourceUrl } from "./pipeline/normalize";

export async function findSourceByUrl(input: string) {
  const canonical = canonicalSourceUrl(input);
  const exact = await prisma.source.findUnique({ where: { url: canonical } });
  if (exact) return exact;
  const sources = await prisma.source.findMany();
  return sources.find((source) => canonicalSourceUrl(source.url) === canonical) ?? null;
}

export async function loadCatalogFromDb() {
  const rows = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    rows,
    catalog: rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      parentSlug: row.parentId ? (byId.get(row.parentId)?.slug ?? null) : null,
      keywords: row.matchWords
        .split(",")
        .map((word) => word.trim())
        .filter(Boolean),
    })),
  };
}

export function resolveCategoryIds(
  rows: { id: string; slug: string }[],
  categorySlug: string,
  subcategorySlug: string | null,
) {
  return {
    categoryId: rows.find((row) => row.slug === categorySlug)?.id ?? null,
    subcategoryId: subcategorySlug ? (rows.find((row) => row.slug === subcategorySlug)?.id ?? null) : null,
  };
}
