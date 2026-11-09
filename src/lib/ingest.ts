import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { randomUUID } from "node:crypto";
import { aiCacheKey } from "./pipeline/classify";
import { prepareLead } from "./pipeline/prepare";
import { canonicalSourceUrl, normalizeUrl } from "./pipeline/normalize";
import { touchExtension } from "./extension-status";
import { collapseIdenticalTexts, enrichPosts } from "./smart/enrich";
import { dispatchNotification, shouldNotify, shouldNotifyExternal } from "./notify";
import { parseFbTime } from "./fb-time";
import { findSourceByUrl, loadCatalogFromDb, postBelongsToSource, resolveCategoryIds } from "./sources";
import { recordTiming } from "./metrics";
import { queueExternalNotification } from "./notification-queue";
import { applyAutomationRules } from "./automation";
import { inServiceArea } from "./service-area";
import { isExpansionOf, isTruncatedText } from "./pipeline/truncation";
import { syncDuplicateLabels } from "./smart/duplicate-labels";
import { assignProducts } from "./products";

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

/** Owner rule: dated posts older than maxPostAgeHours (capped at 24) are never stored. Undated posts pass. */
export function isWithinMaxAge(postedAt: Date | null, maxAgeHours: number, now = Date.now()) {
  if (!postedAt) return true;
  const hours = Math.min(24, Math.max(1, maxAgeHours || 24));
  return now - postedAt.getTime() <= hours * 3600_000;
}

function cleanImages(images: string[] | undefined) {
  return (images ?? [])
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 6);
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

  const [settings, keywords, { rows, catalog }] = await Promise.all([
    getSettings(), prisma.keyword.findMany(), loadCatalogFromDb(),
  ]);
  // Marketplace listings are always offers to sell; never let keyword rules or AI turn them into buyer leads or ads.
  const marketplace = source.type === "facebook_marketplace";
  const rules = keywords.map((keyword) => ({
    word: keyword.word,
    type: keyword.type === "forbidden" ? ("forbidden" as const) : ("watch" as const),
  }));

  const prepared = [];
  let tooOld = 0;
  let outsideSource = 0;
  for (const raw of input.posts) {
    const text = raw.text?.replace(/\u0000/g, "").trim().slice(0, 8000);
    if (!text || text.length < 4 || !raw.url) continue;
    if (!postBelongsToSource(raw.url, source)) {
      outsideSource += 1;
      continue;
    }
    const postedAt = parseDate(raw.postedAt);
    if (!isWithinMaxAge(postedAt, settings.maxPostAgeHours)) {
      tooOld += 1;
      continue;
    }
    const lead = prepareLead({ text, url: raw.url }, rules, catalog);
    prepared.push({ raw: { ...raw, text }, lead, url: normalizeUrl(raw.url), postedAt });
  }

  const existing = prepared.length
    ? await prisma.post.findMany({
        where: {
          OR: [
            { contentHash: { in: prepared.map((item) => item.lead.hash) } },
            { sourceId: source.id, externalUrl: { in: prepared.map((item) => item.url) } },
          ],
        },
        select: { id: true, contentHash: true, externalUrl: true, text: true, sourceId: true, textRevision: true, aiProvider: true },
      })
    : [];

  // A partial re-read must not replace a complete capture. Full edits and expansions
  // are one atomic revision: changing the text also invalidates any in-flight claim.
  let expanded = 0;
  const revisedIds: string[] = [];
  const byUrl = new Map(existing.filter(row => row.sourceId === source.id).map(row => [row.externalUrl, row]));
  for (const item of prepared) {
    const old = byUrl.get(item.url);
    if (!old || old.text === item.raw.text) continue;
    if (isTruncatedText(item.raw.text) && (!isTruncatedText(old.text) || item.raw.text.length <= old.text.length)) continue;
    const ids = resolveCategoryIds(rows, item.lead.categorySlug, item.lead.subcategorySlug);
    const revised = await prisma.$transaction(async tx => {
      const result = await tx.post.updateMany({
        where: { id: old.id, textRevision: old.textRevision },
        data: {
          text: item.raw.text, normalizedText: item.lead.normalizedText,
          contentHash: item.lead.hash, textRevision: { increment: 1 },
          embeddingConfig: "", embeddingKey: "", embeddingRetryAt: new Date(), ocrText: "",
          keywordHitsJson: JSON.stringify(item.lead.watch), forbiddenHit: item.lead.forbidden.length > 0,
          truncated: isTruncatedText(item.raw.text), refetchAfter: null,
          ...(old.aiProvider === "owner" ? {} : {
            categoryId: ids.categoryId, subcategoryId: ids.subcategoryId,
            intent: marketplace ? "seller" : item.lead.intent, province: item.lead.province,
            isAd: marketplace ? false : item.lead.isAd, suggestedReply: item.lead.suggestedReply, aiProvider: "rules",
          }),
        },
      });
      if (!result.count) return false;
      const reset = { status: old.aiProvider === "owner" ? "skipped" : "pending", claimToken: null, attempts: 0, nextAttemptAt: new Date(), lastError: "", latencyMs: null, queueWaitMs: null, createdAt: new Date() };
      await tx.aiJob.upsert({ where: { postId: old.id }, update: reset, create: { postId: old.id, ...reset } });
      return true;
    });
    if (revised) {
      if (isExpansionOf(old.text, item.raw.text)) expanded += 1;
      old.text = item.raw.text; old.contentHash = item.lead.hash; old.textRevision += 1;
      revisedIds.push(old.id);
    }
  }

  const seenHash = new Set(existing.map((item) => item.contentHash));
  const seenUrl = new Set(existing.map((item) => item.externalUrl));
  // Posts already removed by retention: treat as seen so they are not stored or alerted again.
  const removed = prepared.length
    ? await prisma.postTombstone.findMany({
        where: {
          OR: [
            { contentHash: { in: prepared.map((item) => item.lead.hash) } },
            { sourceId: source.id, externalUrl: { in: prepared.map((item) => item.url) } },
          ],
        },
        select: { contentHash: true, externalUrl: true },
      })
    : [];
  for (const row of removed) {
    seenHash.add(row.contentHash);
    if (row.externalUrl) seenUrl.add(row.externalUrl);
  }
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
  recordTiming("ingest_prepare", performance.now() - started);
  const storeStarted = performance.now();
  // One bounded transaction per transport-sized batch. Insert posts and their AI
  // jobs atomically; skipDuplicates also handles concurrent capture of the same URL.
  for (let offset = 0; offset < fresh.length; offset += 40) {
    const data = fresh.slice(offset, offset + 40).map(item => {
      const ids = resolveCategoryIds(rows, item.lead.categorySlug, item.lead.subcategorySlug);
      return {
        id: randomUUID(), sourceId: source.id, externalUrl: item.url,
        authorName: (item.raw.authorName || "").slice(0, 200),
        text: item.raw.text.slice(0, 8000), normalizedText: item.lead.normalizedText.slice(0, 8000),
        truncated: isTruncatedText(item.raw.text), contentHash: item.lead.hash,
        postedAt: item.postedAt, imagesJson: JSON.stringify(cleanImages(item.raw.images)),
        categoryId: ids.categoryId, subcategoryId: ids.subcategoryId,
        intent: marketplace ? "seller" : item.lead.intent, province: item.lead.province,
        isAd: marketplace ? false : item.lead.isAd,
        keywordHitsJson: JSON.stringify(item.lead.watch), forbiddenHit: item.lead.forbidden.length > 0,
        suggestedReply: item.lead.suggestedReply, aiProvider: "rules",
      };
    });
    const inserted = await prisma.$transaction(async tx => {
      await tx.post.createMany({ data, skipDuplicates: true });
      const owned = await tx.post.findMany({ where: { id: { in: data.map(row => row.id) } }, select: { id: true } });
      if (owned.length) await tx.aiJob.createMany({ data: owned.map(post => ({ postId: post.id })) });
      return owned;
    });
    createdIds.push(...inserted.map(post => post.id));
    duplicates += data.length - inserted.length;
  }
  recordTiming("ingest_store", performance.now() - storeStarted);
  const enrichStarted = performance.now();

  if (revisedIds.length) {
    await assignProducts(revisedIds);
    await enrichPosts(revisedIds, [], settings, { embed: false });
  }
  const aiProvider = "rules";
  if (createdIds.length) {
    await collapseIdenticalTexts(fresh.map((item) => item.lead.normalizedText));
    await assignProducts(createdIds).catch((error) => console.error("[products]", error));
    await syncDuplicateLabels(createdIds).catch((error) => console.error("[dup-labels]", error));
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
  // Jobs already exist from the insertion transaction; do not upsert each one again.

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
      message: `${input.actor}: ใหม่ ${uniqueIds.length} ซ้ำ ${duplicates}${tooOld ? ` เก่าเกิน ${tooOld}` : ""}${outsideSource ? ` นอกแหล่ง ${outsideSource}` : ""} จัดโดย ${aiProvider}`,
      postsFound: uniqueIds.length,
    },
  });

  recordTiming("ingest_enrich", performance.now() - enrichStarted);
  const notifyStarted = performance.now();
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

  recordTiming("ingest_notify", performance.now() - notifyStarted);
  return {
    ok: true as const,
    inserted: uniqueIds.length,
    expanded,
    revised: revisedIds.length,
    duplicates,
    tooOld,
    outsideSource,
    source: canonicalSourceUrl(source.url),
  };
  } finally { recordTiming("ingest", performance.now() - started); }
}

export { aiCacheKey };
