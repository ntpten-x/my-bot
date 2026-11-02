import type { CatNode } from "./catalog";
import { detectIntent, type Intent } from "./intent";
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

const DEVICE = /ipad|iphone|ไอแพด|ไอโฟน|แท็บเล็ต|tablet|มือถือ|samsung|การ์ดจอ|โน้ตบุ๊ก|โน๊ตบุ๊ค/i;

export function classifyByRules(text: string, catalog: CatNode[]): {
  categorySlug: string;
  subcategorySlug: string | null;
} {
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
  const categorySlug = parent ? parent.slug : fallback.categorySlug;
  let subcategorySlug: string | null = null;
  if (item.subcategorySlug) {
    const child = catalog.find((node) => node.slug === item.subcategorySlug && node.parentSlug === categorySlug);
    if (child) subcategorySlug = child.slug;
  }
  if (!subcategorySlug && fallback.categorySlug === categorySlug) subcategorySlug = fallback.subcategorySlug;
  const intent: Intent = item.intent === "buyer" || item.intent === "seller" ? item.intent : fallback.intent;
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
    isAd: Boolean(item.isAd) || fallback.isAd,
    suggestedReply,
    urgency: typeof item.urgency === "number" ? Math.max(0, Math.min(1, item.urgency)) : fallback.urgency,
    hasBudget: typeof item.hasBudget === "boolean" ? item.hasBudget : fallback.hasBudget,
    specificity: typeof item.specificity === "number" ? Math.max(0, Math.min(1, item.specificity)) : fallback.specificity,
  };
}
