import type { CatNode } from "./catalog";
import { contentHash, normalizeText, normalizeUrl } from "./normalize";
import { matchKeywords, type KeywordRule } from "./keywords";
import { ruleItem } from "./classify-rules";
import { scoreAd } from "./ad-filter";

export function prepareLead(
  raw: { text: string; url: string },
  rules: KeywordRule[],
  catalog: CatNode[],
) {
  const classified = ruleItem({ id: "preview", text: raw.text }, catalog);
  const keywords = matchKeywords(raw.text, rules);
  const ad = scoreAd(raw.text);
  return {
    normalizedText: normalizeText(raw.text),
    hash: contentHash(raw.text, raw.url),
    url: normalizeUrl(raw.url),
    isAd: ad.isAd || classified.isAd,
    adScore: ad.score,
    watch: keywords.watch,
    forbidden: keywords.forbidden,
    categorySlug: classified.categorySlug,
    subcategorySlug: classified.subcategorySlug,
    intent: classified.intent,
    province: classified.province,
    suggestedReply: classified.suggestedReply,
  };
}
