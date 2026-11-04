import type { CatNode } from "./catalog";
import { STRONG_BUYER, STRONG_SELLER, detectIntent, type Intent } from "./intent";
import { normalizeText } from "./normalize";
import { extractProvince, normalizeProvinceName } from "./province";
import { scoreAd } from "./ad-filter";
import { draftReply } from "./reply";
import { ruleSignals } from "../smart/score";

export type ClassifyInput = { id: string; text: string; contentHash?: string };

export type AiItem = {
  id: string;
  categorySlug: string;
  subcategorySlug: string | null;
  intent: Intent;
  province: string | null;
  isAd: boolean;
  suggestedReply: string;
  urgency: number;
  hasBudget: boolean;
  specificity: number;
};

export type LooseAiItem = {
  id: string;
  categorySlug?: string;
  subcategorySlug?: string | null;
  intent?: string;
  province?: string | null;
  isAd?: boolean;
  suggestedReply?: string;
  urgency?: number;
  hasBudget?: boolean;
  specificity?: number;
};

const DEVICE = /ipad|iphone|ไอแพด|ไอโฟน|แท็บเล็ต|tablet|มือถือ|samsung|การ์ดจอ|โน้ตบุ๊ก|โน๊ตบุ๊ค|คอมพิวเตอร์|โทรศัพท์/i;
const FOOD_VENDOR = /คิวว่าง|เริ่มส่ง|เมนู|อาหาร|ของกิน|ยำ|ลูกชิ้น|สั่งอาหาร|ร้านอาหาร|ข้าวมันไก่|ส้มตำ|ก๋วยเตี๋ยว|กับข้าว/;

// Game accounts, top-ups and rank boosting. "รหัส" alone is not enough: shop codes look like "รหัสMS240685".
const GAME_BOOST = /ดันรหัส|ดันแรง[ค์ก]?|ปั้มแรง[ค์ก]?|รับดัน|ตัวแทนดัน|บูสแรง|boost/i;
const GAME_TOPUP = /เติมเพชร|เติมเกม|เติม\s?uc|เติมยูซี|robux|โรบัค|\bbux\b|เติมคูปอง/i;
const GAME_ID = /ขายรหัส(?!\s?MS)|หารหัส|รหัสเกม|ไอดีเกม|รหัสหญิง|รหัสชาย|ไข่เยอะ|ของพร้อมเล่น|พร้อมเล่น|ไอดีเกม|\bid\s?เกม/i;
const GAME_NAME = /\brov\b|free\s?fire|ฟีฟาย|pubg|พับจี|roblox|โรบล็อก|valorant|วาโล|genshin|mlbb|garena|การีน่า|pet\s?sim|grow a garden|blox\s?fruit|เกม/i;
/** Shop catalogue codes such as "MS240685" (food sellers in the owner's groups). */
export const SHOP_CODE = /(?:^|[^A-Za-z])MS\s?\d{6}(?!\d)/i;

export function foodOverride(text: string) {
  return FOOD_VENDOR.test(text) && !DEVICE.test(text) && !gameRule(text);
}

/** Game post and its sub-category, or null. */
export function gameRule(text: string): { subcategorySlug: string | null } | null {
  if (GAME_BOOST.test(text)) return { subcategorySlug: "game-boost" };
  if (GAME_TOPUP.test(text)) return { subcategorySlug: "game-topup" };
  if (GAME_ID.test(text)) return { subcategorySlug: "game-id" };
  // A game name alone ("โน้ตบุ๊กเล่นเกม") does not beat a device.
  if (GAME_NAME.test(text) && !DEVICE.test(text)) return { subcategorySlug: null };
  return null;
}

/** Rules that win over keyword scoring and over the AI: games, shop codes, food vendors. */
export function forcedCategory(text: string, catalog: CatNode[]): { categorySlug: string; subcategorySlug: string | null } | null {
  const has = (slug: string, parent: string | null = null) =>
    catalog.some((node) => node.slug === slug && (node.parentSlug ?? null) === parent);
  const game = gameRule(text);
  if (game && has("games")) {
    return { categorySlug: "games", subcategorySlug: game.subcategorySlug && has(game.subcategorySlug, "games") ? game.subcategorySlug : null };
  }
  if (SHOP_CODE.test(text) && !DEVICE.test(text) && has("food")) return { categorySlug: "food", subcategorySlug: null };
  if (foodOverride(text) && has("food")) return { categorySlug: "food", subcategorySlug: null };
  return null;
}

export function classifyByRules(text: string, catalog: CatNode[]): {
  categorySlug: string;
  subcategorySlug: string | null;
} {
  const forced = forcedCategory(text, catalog);
  if (forced) return forced;
  if (DEVICE.test(text) && catalog.some((node) => node.slug === "it" && !node.parentSlug)) {
    return { categorySlug: "it", subcategorySlug: null };
  }
  const normalized = normalizeText(text);
  let best: { slug: string; parentSlug: string | null; score: number } = {
    slug: "other",
    parentSlug: null,
    score: 0,
  };
  for (const node of catalog) {
    if (node.slug === "other") continue;
    let score = 0;
    for (const keyword of node.keywords) {
      const needle = normalizeText(keyword);
      if (!needle) continue;
      if (normalized.includes(needle)) score += needle.length;
    }
    if (score > 0 && node.parentSlug) score += 12;
    if (score > best.score) {
      best = { slug: node.slug, parentSlug: node.parentSlug, score };
    }
  }
  if (best.score === 0) return { categorySlug: "other", subcategorySlug: null };
  if (best.parentSlug) return { categorySlug: best.parentSlug, subcategorySlug: best.slug };
  return { categorySlug: best.slug, subcategorySlug: null };
}

export function ruleItem(post: ClassifyInput, catalog: CatNode[]): AiItem {
  const classified = classifyByRules(post.text, catalog);
  const intent = detectIntent(post.text);
  const province = extractProvince(post.text);
  const ad = scoreAd(post.text);
  const label =
    catalog.find((item) => item.slug === (classified.subcategorySlug || classified.categorySlug))?.name ||
    "ประกาศ";
  const signals = ruleSignals(post.text);
  return {
    id: post.id,
    categorySlug: classified.categorySlug,
    subcategorySlug: classified.subcategorySlug,
    intent,
    province,
    isAd: ad.isAd,
    suggestedReply: draftReply(intent, label),
    urgency: signals.urgency,
    hasBudget: signals.hasBudget,
    specificity: signals.specificity,
  };
}

export function sanitizeAiItem(item: LooseAiItem, post: ClassifyInput, catalog: CatNode[]): AiItem {
  const fallback = ruleItem(post, catalog);
  const parent = catalog.find((node) => node.slug === item.categorySlug && !node.parentSlug);
  let categorySlug = parent ? parent.slug : fallback.categorySlug;
  let subcategorySlug: string | null = null;
  if (item.subcategorySlug) {
    const child = catalog.find((node) => node.slug === item.subcategorySlug && node.parentSlug === categorySlug);
    if (child) subcategorySlug = child.slug;
  }
  if (!subcategorySlug && fallback.categorySlug === categorySlug) subcategorySlug = fallback.subcategorySlug;
  if ((categorySlug === "other" || !parent) && fallback.categorySlug !== "other") {
    categorySlug = fallback.categorySlug;
    subcategorySlug = fallback.subcategorySlug;
  }
  const forced = forcedCategory(post.text, catalog);
  if (forced) {
    categorySlug = forced.categorySlug;
    subcategorySlug = forced.subcategorySlug ?? (categorySlug === categorySlugFromAi(item) ? subcategorySlug : null);
  }
  const isAd = Boolean(item.isAd) || fallback.isAd;
  let intent: Intent;
  if (isAd || fallback.intent === "ad") intent = "ad";
  else if ((STRONG_SELLER.test(post.text) || SHOP_CODE.test(post.text)) && !STRONG_BUYER.test(post.text)) intent = "seller";
  else if (item.intent === "buyer" || item.intent === "seller" || item.intent === "ad") intent = item.intent;
  else intent = fallback.intent;
  const province = normalizeProvinceName(item.province) || fallback.province;
  const suggestedReply =
    typeof item.suggestedReply === "string" && item.suggestedReply.trim()
      ? item.suggestedReply.trim().slice(0, 500)
      : fallback.suggestedReply;
  return {
    id: post.id,
    categorySlug,
    subcategorySlug,
    intent,
    province,
    isAd,
    suggestedReply,
    urgency: typeof item.urgency === "number" ? Math.max(0, Math.min(1, item.urgency)) : fallback.urgency,
    hasBudget: typeof item.hasBudget === "boolean" ? item.hasBudget : fallback.hasBudget,
    specificity: typeof item.specificity === "number" ? Math.max(0, Math.min(1, item.specificity)) : fallback.specificity,
  };
}

function categorySlugFromAi(item: LooseAiItem) {
  return item.categorySlug ?? "";
}
