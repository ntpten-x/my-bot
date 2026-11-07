import type { CatNode } from "./catalog";
import { STRONG_BUYER, STRONG_SELLER, detectIntent, type Intent } from "./intent";
import { normalizeText } from "./normalize";
import { extractProvince, normalizeProvinceName } from "./province";
import { scoreAd } from "./ad-filter";
import { draftReply, isUsableSuggestedReply } from "./reply";
import { ruleSignals } from "../smart/score";
import { isDominant, type GroupHint } from "./group-profile";

export type ClassifyInput = { id: string; text: string; contentHash?: string; groupHint?: GroupHint | null };

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
  /** Level-3 product/game slug the AI picked; checked against the product list later. */
  productSlug?: string | null;
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
  productSlug?: string | null;
};

const DEVICE = /ipad|iphone|ไอแพด|ไอโฟน|แท็บเล็ต|tablet|มือถือ|samsung|การ์ดจอ|โน้ตบุ๊ก|โน๊ตบุ๊ค|คอมพิวเตอร์|โทรศัพท์/i;
const FOOD_VENDOR = /คิวว่าง|เริ่มส่ง|เมนู|อาหาร|ของกิน|ยำ|ลูกชิ้น|สั่งอาหาร|ร้านอาหาร|ข้าวมันไก่|ส้มตำ|ก๋วยเตี๋ยว|กับข้าว/;

// Game accounts, top-ups and rank boosting. "รหัส" alone is not enough: shop codes look like "รหัสMS240685".
const GAME_BOOST = /ดันรหัส|ดันแรง[ค์ก]?|ปั้มแรง[ค์ก]?|รับดัน|ตัวแทนดัน|บูสแรง|boost/i;
// Robux slang: "โรแท้", "โรพลัส", "โรเรท3.2", "1900โร", "เรท 3", "101 เพ็ด/เพ้ด".
const GAME_TOPUP = /เติมเพชร|เติมเกม|เติม\s?uc|เติมยูซี|robux|โรบัค|โรบูด|\bbux\b|เติมคูปอง|โรแท้|โรพลัส|โรเรท|โร\s?เรท|\d\s?โร(?![ก-ฮ])|เรท\s?\d|เพ[็้]ด|เติมโร/i;
const GAME_ID = /ขายรหัส(?!\s?MS)|หารหัส|รหัสเกม|ไอดีเกม|รหัสหญิง|รหัสชาย|ไข่เยอะ|ของพร้อมเล่น|พร้อมเล่น|\bid\s?เกม|ติดเวด|ไอเทม|ไอเท็ม|ปัก\s?\d|แมพ/i;
const GAME_MIDDLEMAN = /คนกลาง|กลางเครดิต|หากลาง|รับกลาง|ตัวกลาง|ใช้กลาง|มีกลาง/;
const GAME_NAME = /\brov\b|free\s?fire|ฟีฟาย|pubg|พับจี|roblox|โรบล็อก|valorant|วาโล|genshin|mlbb|garena|การีน่า|pet\s?sim|grow a garden|blox\s?fruit|เกม/i;
/** "เติม" on its own is a top-up only inside a game group (not fuel, gas, ink or money). */
const BARE_TOPUP = /เติม/;
const NOT_TOPUP = /น้ำมัน|แก๊ส|ลม|หมึก|เงิน|น้ำยา/;
/** Unambiguous food words; "คิวว่าง"/"เริ่มส่ง"/"ไก่" alone are not enough inside a game group. */
const CLEAR_MENU = /เมนู|ร้านอาหาร|สั่งอาหาร|อาหาร|ข้าวมันไก่|ส้มตำ|ก๋วยเตี๋ยว|กับข้าว|ลูกชิ้น|ของกิน|ขนม|กาแฟ/;
/** Shop catalogue codes such as "MS240685" (food sellers in the owner's groups). */
export const SHOP_CODE = /(?:^|[^A-Za-z])MS\s?\d{6}(?!\d)/i;

/** Collapse repeated Thai letters ("เติมม" -> "เติม", "มากกก" -> "มาก") and common typos before matching. */
export function squeezeRepeats(text: string) {
  return text.replace(/([\u0E01-\u0E4E])\1+/g, "$1").replace(/เตืม/g, "เติม");
}

function gameGroup(hint?: GroupHint | null) {
  return isDominant(hint, "games");
}

export function foodOverride(text: string, hint?: GroupHint | null) {
  const t = squeezeRepeats(text);
  if (!FOOD_VENDOR.test(t) || DEVICE.test(t) || gameRule(t, hint)) return false;
  // In a game group only a shop code or a clear menu makes a post food.
  if (gameGroup(hint)) return SHOP_CODE.test(t) || CLEAR_MENU.test(t);
  return true;
}

/** Game post and its sub-category, or null. */
export function gameRule(text: string, hint?: GroupHint | null): { subcategorySlug: string | null } | null {
  const t = squeezeRepeats(text);
  const inGames = gameGroup(hint);
  if (GAME_BOOST.test(t)) return { subcategorySlug: "game-boost" };
  if (GAME_MIDDLEMAN.test(t) && (inGames || GAME_NAME.test(t) || GAME_TOPUP.test(t) || GAME_ID.test(t))) return { subcategorySlug: "game-middleman" };
  if (GAME_TOPUP.test(t)) return { subcategorySlug: "game-topup" };
  if (GAME_ID.test(t)) return { subcategorySlug: "game-id" };
  if (inGames && BARE_TOPUP.test(t) && !NOT_TOPUP.test(t)) return { subcategorySlug: "game-topup" };
  // A game name alone ("โน้ตบุ๊กเล่นเกม") does not beat a device.
  if (GAME_NAME.test(t) && !DEVICE.test(t)) return { subcategorySlug: null };
  return null;
}

/** Rules that win over keyword scoring and over the AI: games, shop codes, food vendors. */
export function forcedCategory(
  text: string,
  catalog: CatNode[],
  hint?: GroupHint | null,
): { categorySlug: string; subcategorySlug: string | null } | null {
  const has = (slug: string, parent: string | null = null) =>
    catalog.some((node) => node.slug === slug && (node.parentSlug ?? null) === parent);
  const game = gameRule(text, hint);
  if (game && has("games")) {
    return { categorySlug: "games", subcategorySlug: game.subcategorySlug && has(game.subcategorySlug, "games") ? game.subcategorySlug : null };
  }
  if (SHOP_CODE.test(text) && !DEVICE.test(text) && has("food")) return { categorySlug: "food", subcategorySlug: null };
  if (foodOverride(text, hint) && has("food")) return { categorySlug: "food", subcategorySlug: null };
  return null;
}

/** Food inside a game group without a shop code or a clear menu is almost always an in-game item. */
export function foodBlockedByGroup(text: string, hint?: GroupHint | null) {
  const t = squeezeRepeats(text);
  return gameGroup(hint) && !SHOP_CODE.test(t) && !CLEAR_MENU.test(t);
}

/** Trade signal: a price, a number, or buy/sell wording. Used before the group tie-breaker. */
const TRADE_SIGNAL = /\d|บาท|฿|ขาย|ซื้อ|หา|รับ|ส่ง|ราคา|ทัก|ว่าง/;

export function classifyByRules(text: string, catalog: CatNode[], hint?: GroupHint | null): {
  categorySlug: string;
  subcategorySlug: string | null;
} {
  const forced = forcedCategory(text, catalog, hint);
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
  const top = best.parentSlug ?? best.slug;
  // Tie-breaker: an unclear trade post in a group that is >70% one category takes that category.
  const groupWins =
    hint && isDominant(hint) && catalog.some((node) => node.slug === hint.categorySlug && !node.parentSlug) &&
    ((best.score === 0 && TRADE_SIGNAL.test(squeezeRepeats(text))) || (top === "food" && foodBlockedByGroup(text, hint) && hint.categorySlug !== "food"));
  if (groupWins) return { categorySlug: hint.categorySlug, subcategorySlug: null };
  if (best.score === 0) return { categorySlug: "other", subcategorySlug: null };
  if (best.parentSlug) return { categorySlug: best.parentSlug, subcategorySlug: best.slug };
  return { categorySlug: best.slug, subcategorySlug: null };
}

export function ruleItem(post: ClassifyInput, catalog: CatNode[]): AiItem {
  const classified = classifyByRules(post.text, catalog, post.groupHint);
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
  const forced = forcedCategory(post.text, catalog, post.groupHint);
  if (!forced && categorySlug === "food" && post.groupHint && foodBlockedByGroup(post.text, post.groupHint)) {
    categorySlug = fallback.categorySlug === "food" ? post.groupHint.categorySlug : fallback.categorySlug;
    subcategorySlug = fallback.categorySlug === categorySlug ? fallback.subcategorySlug : null;
  }
  if (forced) {
    categorySlug = forced.categorySlug;
    subcategorySlug = forced.subcategorySlug ?? (categorySlug === categorySlugFromAi(item) ? subcategorySlug : null);
  }
  // Rules saw a discussion post and no ad signal: an AI "ad" flag does not turn talk into an ad.
  const isAd = fallback.intent === "chat" && !fallback.isAd ? false : Boolean(item.isAd) || fallback.isAd;
  let intent: Intent;
  if (isAd || fallback.intent === "ad") intent = "ad";
  else if ((STRONG_SELLER.test(post.text) || SHOP_CODE.test(post.text)) && !STRONG_BUYER.test(post.text)) intent = "seller";
  else if (fallback.intent === "chat" && (item.intent === "chat" || item.intent === "unknown" || !item.intent)) intent = "chat";
  else if (item.intent === "buyer" || item.intent === "seller" || item.intent === "ad" || item.intent === "chat") intent = item.intent;
  else intent = fallback.intent;
  const province = normalizeProvinceName(item.province) || fallback.province;
  const rawReply = typeof item.suggestedReply === "string" ? item.suggestedReply.trim().slice(0, 500) : "";
  const suggestedReply = isUsableSuggestedReply(rawReply, intent) ? rawReply : fallback.suggestedReply;
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
    productSlug: typeof item.productSlug === "string" && item.productSlug.trim() ? item.productSlug.trim().toLowerCase().slice(0, 60) : null,
  };
}

function categorySlugFromAi(item: LooseAiItem) {
  return item.categorySlug ?? "";
}
