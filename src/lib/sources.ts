import { prisma } from "./prisma";
import { canonicalSourceUrl } from "./pipeline/normalize";

/** Group slug or numeric id from a Facebook group URL, lower-cased ("" when not a group URL). */
export function facebookGroupKey(input: string): string {
  const match = canonicalSourceUrl(input).match(/^https:\/\/www\.facebook\.com\/groups\/([^/?#]+)$/i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : "";
}

export async function findSourceByUrl(input: string) {
  const canonical = canonicalSourceUrl(input);
  const exact = await prisma.source.findUnique({ where: { url: canonical } });
  if (exact) return exact;
  const sources = await prisma.source.findMany();
  const same = sources.find((source) => canonicalSourceUrl(source.url) === canonical);
  if (same) return same;
  // Same Facebook group under another URL form: vanity name <-> numeric id (learned from the page),
  // or a different letter case. Only exact group-key matches, never a guess.
  const key = facebookGroupKey(input);
  if (!key) return null;
  return (
    sources.find((source) => source.type === "facebook_group" && (facebookGroupKey(source.url) === key || source.fbGroupId === key)) ??
    null
  );
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
