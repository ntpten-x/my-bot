import { prisma } from "../prisma";
import { loadCatalogFromDb, resolveCategoryIds } from "../sources";
import { sanitizeAiItem } from "./classify-rules";
import { ruleSignals, scoreLead } from "../smart/score";

export async function repairStoredOverrides(limit = 80) {
  const posts = await prisma.post.findMany({
    where: {
      duplicateOfId: null,
      OR: [
        { intent: "buyer", text: { contains: "พร้อมส่ง" } },
        { intent: "buyer", text: { contains: "รับออกแบบ" } },
        { intent: "buyer", text: { contains: "รับทำ" } },
        { isAd: true, NOT: { intent: "ad" } },
        { category: { is: { slug: "other" } }, text: { contains: "ยำ" } },
        { category: { is: { slug: "other" } }, text: { contains: "ลูกชิ้น" } },
        { categoryId: null, text: { contains: "ยำ" } },
        { categoryId: null, text: { contains: "ลูกชิ้น" } },
      ],
    },
    include: { category: true, subcategory: true, source: true },
    take: limit,
  });
  if (!posts.length) return 0;
  const { rows, catalog } = await loadCatalogFromDb();
  let fixed = 0;
  for (const post of posts) {
    const clean = sanitizeAiItem(
      {
        id: post.id,
        categorySlug: post.category?.slug,
        subcategorySlug: post.subcategory?.slug ?? null,
        intent: post.intent,
        province: post.province,
        isAd: post.isAd,
        suggestedReply: post.suggestedReply,
      },
      { id: post.id, text: post.text },
      catalog,
    );
    const ids = resolveCategoryIds(rows, clean.categorySlug, clean.subcategorySlug);
    const changed =
      clean.intent !== post.intent ||
      clean.isAd !== post.isAd ||
      ids.categoryId !== (post.categoryId ?? null) ||
      ids.subcategoryId !== (post.subcategoryId ?? null);
    if (!changed) continue;
    let keywords: string[] = [];
    try {
      const parsed = JSON.parse(post.keywordHitsJson);
      if (Array.isArray(parsed)) keywords = parsed.map(String);
    } catch {
      keywords = [];
    }
    const scored = scoreLead({
      text: post.text,
      intent: clean.intent,
      isAd: clean.isAd,
      forbidden: post.forbiddenHit,
      keywordHits: keywords.length,
      ageHours: Math.max(0, (Date.now() - post.createdAt.getTime()) / 3600000),
      sourceQuality: post.source.lastError ? 0.35 : 0.85,
      signals: ruleSignals(post.text),
    });
    await prisma.post.update({
      where: { id: post.id },
      data: {
        intent: clean.intent,
        isAd: clean.isAd,
        categoryId: ids.categoryId,
        subcategoryId: ids.subcategoryId,
        province: clean.province,
        suggestedReply: clean.suggestedReply,
        score: scored.score,
        scoreReason: scored.reason,
      },
    });
    fixed += 1;
  }
  return fixed;
}
