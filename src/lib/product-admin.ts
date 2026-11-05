import { prisma } from "./prisma";
import { parseAliases } from "./pipeline/products";

export function productSlug(name: string) {
  const base = name
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .slice(0, 48);
  return base || `product-${Date.now().toString(36)}`;
}

export function serializeProduct(row: { id: string; slug: string; name: string; nameEn: string; categorySlug: string; aliases: string; enabled: boolean; sortOrder: number }) {
  return { id: row.id, slug: row.slug, name: row.name, nameEn: row.nameEn, categorySlug: row.categorySlug, aliases: parseAliases(row.aliases), enabled: row.enabled, sortOrder: row.sortOrder };
}

const FOLLOW_KEY = "followed_products";

export async function readFollowedProducts(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: FOLLOW_KEY } });
  try {
    const parsed = JSON.parse(row?.value ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 50) : [];
  } catch {
    return [];
  }
}

export async function writeFollowedProducts(ids: string[]) {
  const value = JSON.stringify([...new Set(ids)].slice(0, 50));
  await prisma.setting.upsert({ where: { key: FOLLOW_KEY }, update: { value }, create: { key: FOLLOW_KEY, value } });
  return JSON.parse(value) as string[];
}
