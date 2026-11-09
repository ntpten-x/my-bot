import { prisma } from "./prisma";
import { canonicalSourceUrl } from "./pipeline/normalize";

/** Group slug or numeric id from a Facebook group URL, lower-cased ("" when not a group URL). */
export function facebookGroupKey(input: string): string {
  const match = canonicalSourceUrl(input).match(/^https:\/\/www\.facebook\.com\/groups\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : "";
}

/** True when a captured post URL belongs to the configured source (vanity or learned numeric id). */
export function postBelongsToSource(
  postUrl: string,
  source: { url: string; type: string; fbGroupId?: string | null },
): boolean {
  if (source.type === "facebook_group") {
    const postGroup = facebookGroupKey(postUrl);
    if (!postGroup) return false;
    const allowed = new Set(
      [facebookGroupKey(source.url), source.fbGroupId?.toLowerCase() || ""].filter(Boolean),
    );
    return allowed.has(postGroup);
  }
  if (source.type === "facebook_marketplace") {
    try {
      const url = new URL(postUrl);
      const host = url.hostname.toLowerCase().replace(/^m\./, "").replace(/^web\./, "");
      return (host === "facebook.com" || host === "www.facebook.com") && /^\/marketplace\/item\//i.test(url.pathname);
    } catch {
      return false;
    }
  }
  return true;
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
