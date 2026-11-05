import { squeezeRepeats } from "./classify-rules";

/** Level 3 of the taxonomy (category → sub-category → product/game). */
export type ProductNode = {
  id?: string;
  slug: string;
  name: string;
  nameEn: string;
  categorySlug: string;
  aliases: string[];
  enabled?: boolean;
};

export type ProductBy = "rules" | "ai" | "group" | "owner" | "none";

const p = (slug: string, name: string, nameEn: string, categorySlug: string, aliases: string[]): ProductNode => ({ slug, name, nameEn, categorySlug, aliases });

export const PRODUCT_SEEDS: ProductNode[] = [
  p("roblox", "Roblox", "Roblox", "games", ["roblox", "robux", "โรบลอกซ์", "โรบล็อก", "โรบัค", "โรบูด", "โรแท้", "โรพลัส", "โรเรท", "เติมโร", "โร", "blox fruit", "บล็อกฟรุต", "grow a garden", "ติดเวด", "เพ็ด", "เพ้ด"]),
  p("rov", "ROV", "Arena of Valor", "games", ["rov", "aov", "realm of valor", "arena of valor", "อาร์โอวี", "คูปองrov", "คูปอง rov"]),
  p("free-fire", "Free Fire", "Free Fire", "games", ["free fire", "freefire", "ff", "ฟีฟาย", "ฟรีฟาย", "เพชรff", "เพชร ff"]),
  p("pubg", "PUBG", "PUBG Mobile", "games", ["pubg", "พับจี", "uc pubg", "pubgm"]),
  p("mlbb", "Mobile Legends", "Mobile Legends: Bang Bang", "games", ["mobile legend", "mobile legends", "mlbb", "โมบายเลเจนด์", "โมบาย เลเจนด์"]),
  p("valorant", "Valorant", "Valorant", "games", ["valorant", "valo", "วาโล", "วาโลแรนท์", "vp valorant"]),
  p("genshin", "Genshin Impact", "Genshin Impact", "games", ["genshin", "เก็นชิน", "เกนชิน", "genesis crystal"]),
  p("seven-knights", "Seven Knights Re:Birth", "Seven Knights Re:Birth", "games", ["seven knights", "7 knights", "เซเว่นไนท์", "เซเว่นไนต์"]),
  p("cookie-run", "Cookie Run", "Cookie Run", "games", ["cookie run", "cookierun", "คุกกี้รัน", "crumble", "cookierun crumble"]),
  p("efootball", "eFootball", "eFootball", "games", ["efootball", "e football", "pes", "อีฟุตบอล", "วินนิ่ง"]),
  p("heartopia", "Heartopia", "Heartopia", "games", ["heartopia", "ฮาร์ทโทเปีย", "ฮาร์โทเปีย"]),
  p("iphone", "iPhone", "iPhone", "it", ["iphone", "ไอโฟน"]),
  p("ipad", "iPad", "iPad", "it", ["ipad", "ไอแพด"]),
  p("android-phone", "มือถือ Android", "Android phone", "it", ["samsung", "ซัมซุง", "galaxy", "oppo", "vivo", "xiaomi", "redmi", "realme", "huawei"]),
  p("notebook", "โน้ตบุ๊ก", "Notebook", "it", ["notebook", "laptop", "โน้ตบุ๊ก", "โน๊ตบุ๊ค", "โน้ตบุ๊ค", "macbook", "แมคบุ๊ก"]),
  p("pc", "คอมพิวเตอร์/การ์ดจอ", "PC & parts", "it", ["การ์ดจอ", "rtx", "gtx", "คอมประกอบ", "cpu", "เมนบอร์ด"]),
];

/** Lowercase, NFKC (folds 𝑹𝒐𝒃𝒍𝒐𝒙-style fancy letters), drop zero-width marks, collapse repeated Thai letters and spaces. */
export function normalizeForAlias(text: string) {
  return squeezeRepeats(text.normalize("NFKC").toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, "")).replace(/\s+/g, " ");
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const regexCache = new Map<string, RegExp>();

/**
 * Latin aliases must stand alone ("ff" not in "offer", "ml" not in "html"); a digit may touch them ("100ff").
 * Short Thai aliases (≤ 3 letters, e.g. "โร") must not run into another consonant, so "โรงเรียน"/"โรค" do not count.
 */
export function aliasRegex(alias: string) {
  const key = alias;
  const hit = regexCache.get(key);
  if (hit) return hit;
  const a = normalizeForAlias(alias).trim();
  const body = escape(a).replace(/ /g, "\\s?");
  let source: string;
  if (/^[a-z0-9 .:'-]+$/.test(a)) source = `(?<![a-z])${body}(?![a-z])`;
  else if (a.length <= 3) source = `${body}(?![ก-ฮ])`;
  else source = body;
  const regex = new RegExp(source, "u");
  regexCache.set(key, regex);
  return regex;
}

export type ProductMatch = { slug: string; score: number; aliases: string[] };

/** Every enabled product whose alias appears, best first (longer and more aliases score higher). */
export function matchProducts(text: string, products: ProductNode[]): ProductMatch[] {
  const norm = normalizeForAlias(text);
  const out: ProductMatch[] = [];
  for (const product of products) {
    if (product.enabled === false) continue;
    const hits = product.aliases.filter((alias) => alias.trim() && aliasRegex(alias).test(norm));
    if (!hits.length) continue;
    out.push({ slug: product.slug, aliases: hits, score: hits.reduce((sum, alias) => sum + Math.min(alias.length, 8), 0) });
  }
  return out.sort((a, b) => b.score - a.score);
}

export type PickInput = {
  text: string;
  /** Final top-level category of the post. */
  categorySlug: string | null;
  /** What the AI picked; ignored unless it is in the list. */
  aiSlug?: string | null;
  /** The group's default product (owner binding or auto suggestion). */
  groupProduct?: string | null;
};

/** Rules first, then the AI's pick from the list, then the group default as a tie-breaker / fallback; else none. */
export function pickProduct(input: PickInput, products: ProductNode[]): { slug: string | null; by: ProductBy } {
  const enabled = products.filter((item) => item.enabled !== false);
  const bySlug = new Map(enabled.map((item) => [item.slug, item]));
  const fits = (slug: string | null | undefined) => {
    const product = slug ? bySlug.get(slug) : undefined;
    if (!product) return null;
    if (input.categorySlug && input.categorySlug !== "other" && product.categorySlug !== input.categorySlug) return null;
    return product;
  };
  const matches = matchProducts(input.text, enabled).filter((match) => fits(match.slug));
  if (matches.length) {
    const top = matches.filter((match) => match.score === matches[0].score);
    const tie = input.groupProduct && top.find((match) => match.slug === input.groupProduct);
    return { slug: (tie || top[0]).slug, by: "rules" };
  }
  if (fits(input.aiSlug)) return { slug: input.aiSlug!, by: "ai" };
  const group = fits(input.groupProduct);
  if (group && input.categorySlug === group.categorySlug) return { slug: group.slug, by: "group" };
  return { slug: null, by: "none" };
}

/** Auto suggestion for a group's default product: one product owns ≥ 60% of its product-labelled posts (min 5). */
export function suggestGroupProduct(counts: Record<string, number>, min = 5, share = 0.6): { slug: string; share: number; total: number } | null {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total < min) return null;
  const [slug, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count / total >= share ? { slug, share: count / total, total } : null;
}

/** "roblox,rov,…" per category for the AI prompt; kept short on purpose. */
export function productPrompt(products: ProductNode[]) {
  const by = new Map<string, string[]>();
  for (const product of products) if (product.enabled !== false) by.set(product.categorySlug, [...(by.get(product.categorySlug) ?? []), product.slug]);
  return [...by.entries()].map(([category, slugs]) => `${category}: ${slugs.join(",")}`).join("\n");
}

export const parseAliases = (value: string) =>
  [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 60);
