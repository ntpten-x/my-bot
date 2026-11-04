import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { enqueueAiJobs } from "./ai/queue";
import { aiCacheKey } from "./pipeline/classify";
import { prepareLead } from "./pipeline/prepare";
import { canonicalSourceUrl, normalizeUrl } from "./pipeline/normalize";
import { touchExtension } from "./extension-status";
import { collapseIdenticalTexts, enrichPosts } from "./smart/enrich";
import { dispatchNotification, shouldNotify, shouldNotifyExternal } from "./notify";
import { parseFbTime } from "./fb-time";
import { findSourceByUrl, loadCatalogFromDb, resolveCategoryIds } from "./sources";
import { recordTiming } from "./metrics";
import { queueExternalNotification } from "./notification-queue";
import { applyAutomationRules } from "./automation";
import { inServiceArea } from "./service-area";

export type IncomingPost = {
  url: string;
  authorName?: string;
  text: string;
  postedAt?: string | null;
  images?: string[];
};

/**
 * Post time from the extension: ISO strings, or raw Facebook text ("3 ชม.", "เมื่อวานนี้ เวลา 14:20")
 * read in Asia/Bangkok. Times in the future (beyond 1 hour of clock skew) or before 2004 are dropped.
 */
export function parseDate(value?: string | null, now = Date.now()) {
  if (!value) return null;
  const text = String(value).trim();
  let ms = /^\d{4}-\d{2}-\d{2}/.test(text) ? Date.parse(text) : NaN;
  if (Number.isNaN(ms)) {
    const parsed = parseFbTime(text, now);
    ms = parsed ? Date.parse(parsed) : NaN;
  }
  if (Number.isNaN(ms) || ms > now + 3600_000 || ms < Date.UTC(2004, 0, 1)) return null;
  return new Date(ms);
}

function cleanImages(images: string[] | undefined) {
  return (images ?? [])
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 6);
}

function isUniqueError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002";
}

export async function ingestPosts(input: {
  sourceUrl: string;
  posts: IncomingPost[];
  actor: "extension" | "worker";
}) {
  const started = performance.now();
  try {
  const source = await findSourceByUrl(input.sourceUrl);
  if (!source) return { ok: false as const, error: "ไม่พบแหล่งข้อมูลนี้ในระบบ", inserted: 0, duplicates: 0 };
  if (!source.enabled) {
    return { ok: true as const, skipped: true, reason: "แหล่งนี้ถูกปิดไว้", inserted: 0, duplicates: 0 };
  }

  const settings = await getSettings();
  // Marketplace listings are always offers to sell; never let keyword rules or AI turn them into buyer leads or ads.
  const marketplace = source.type === "facebook_marketplace";
  const keywords = await prisma.keyword.findMany();
  const { rows, catalog } = await loadCatalogFromDb();
  const rules = keywords.map((keyword) => ({
    word: keyword.word,
    type: keyword.type === "forbidden" ? ("forbidden" as const) : ("watch" as const),
  }));

  const prepared = [];
  for (const raw of input.posts) {
    const text = raw.text?.replace(/\u0000/g, "").trim();
    if (!text || text.length < 4 || !raw.url) continue;
    const lead = prepareLead({ text, url: raw.url }, rules, catalog);
    prepared.push({ raw: { ...raw, text }, lead, url: normalizeUrl(raw.url) });
  }

  const existing = prepared.length
    ? await prisma.post.findMany({
        where: {
          OR: [
            { contentHash: { in: prepared.map((item) => item.lead.hash) } },
            { sourceId: source.id, externalUrl: { in: prepared.map((item) => item.url) } },
          ],
        },
        select: { contentHash: true, externalUrl: true },
      })
    : [];

  const seenHash = new Set(existing.map((item) => item.contentHash));
  const seenUrl = new Set(existing.map((item) => item.externalUrl));
  let duplicates = 0;
  const fresh = [];
  for (const item of prepared) {
    if (seenHash.has(item.lead.hash) || seenUrl.has(item.url)) {
      duplicates += 1;
      continue;
    }
    seenHash.add(item.lead.hash);
    seenUrl.add(item.url);
    fresh.push(item);
  }

  const createdIds: string[] = [];
  for (const item of fresh) {
    const ids = resolveCategoryIds(rows, item.lead.categorySlug, item.lead.subcategorySlug);
    try {
      const post = await prisma.post.create({
        data: {
          sourceId: source.id,
          externalUrl: item.url,
          authorName: (item.raw.authorName || "").slice(0, 200),
          text: item.raw.text.slice(0, 8000),
          normalizedText: item.lead.normalizedText.slice(0, 8000),
          contentHash: item.lead.hash,
          postedAt: parseDate(item.raw.postedAt),
          imagesJson: JSON.stringify(cleanImages(item.raw.images)),
          categoryId: ids.categoryId,
          subcategoryId: ids.subcategoryId,
          intent: marketplace ? "seller" : item.lead.intent,
          province: item.lead.province,
          isAd: marketplace ? false : item.lead.isAd,
          keywordHitsJson: JSON.stringify(item.lead.watch),
          forbiddenHit: item.lead.forbidden.length > 0,
          suggestedReply: item.lead.suggestedReply,
          aiProvider: "rules",
        },
      });
      createdIds.push(post.id);
    } catch (error) {
      if (isUniqueError(error)) duplicates += 1;
      else throw error;
    }
  }

  const aiProvider = "rules";
  if (createdIds.length) {
    await collapseIdenticalTexts(fresh.map((item) => item.lead.normalizedText));
  }
  const uniqueIds = createdIds.length
    ? (
        await prisma.post.findMany({
          where: { id: { in: createdIds }, duplicateOfId: null },
          select: { id: true },
        })
      ).map((post) => post.id)
    : [];
  duplicates += createdIds.length - uniqueIds.length;
  if (uniqueIds.length) await enqueueAiJobs(uniqueIds);

  await prisma.source.update({
    where: { id: source.id },
    data: {
      lastFetchedAt: new Date(),
      lastError: null,
      ...(input.actor === "extension" ? { lastExtensionAt: new Date() } : {}),
    },
  });
  if (input.actor === "extension") await touchExtension(source.id);
  if (uniqueIds.length) await enrichPosts(uniqueIds, [], settings, { embed: false });
  await prisma.fetchLog.create({
    data: {
      sourceId: source.id,
      status: "ok",
      message: `${input.actor}: ใหม่ ${uniqueIds.length} ซ้ำ ${duplicates} จัดโดย ${aiProvider}`,
      postsFound: uniqueIds.length,
    },
  });

  if (uniqueIds.length) {
    await applyAutomationRules(uniqueIds).catch((error) => console.error("[automation]", error));
    const ready = await prisma.post.findMany({
      where: { id: { in: uniqueIds }, duplicateOfId: null, dismissed: false },
      include: { category: true, subcategory: true, source: true },
    });
    for (const post of ready) {
      if (!shouldNotify(post) || post.score < settings.notifyMinScore) continue;
      if (settings.serviceAreaNotifyOnly && !inServiceArea(post.province, settings.serviceProvinces)) continue;
      const title = post.score >= 80 ? "ลีดร้อน" : "ลีดใหม่";
      await dispatchNotification(post, settings, title);
      if (shouldNotifyExternal(post)) await queueExternalNotification(post.id, title);
    }
  }

  return {
    ok: true as const,
    inserted: uniqueIds.length,
    duplicates,
    source: canonicalSourceUrl(source.url),
  };
  } finally { recordTiming("ingest", performance.now() - started); }
}

export { aiCacheKey };
