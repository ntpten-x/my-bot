import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { randomUUID } from "node:crypto";
import { aiCacheKey } from "./pipeline/classify";
import { prepareLead } from "./pipeline/prepare";
import { canonicalSourceUrl, normalizeUrl } from "./pipeline/normalize";
import { touchExtension } from "./extension-status";
import { collapseIdenticalTexts, enrichPosts } from "./smart/enrich";
import { messageFor, shouldNotify, shouldNotifyExternal } from "./notify";
import type { Prisma } from "@prisma/client";
import { parseFbTime } from "./fb-time";
import { findSourceByUrl, loadCatalogFromDb, postBelongsToSource, resolveCategoryIds } from "./sources";
import { recordTiming } from "./metrics";
import { applyAutomationRules } from "./automation";
import { inServiceArea } from "./service-area";
import { isExpansionOf, isTruncatedText } from "./pipeline/truncation";
import { syncDuplicateLabels } from "./smart/duplicate-labels";
import { assignProducts } from "./products";
import { pendingPostWork, runPostProcessing, type PostRevision } from "./post-processing";

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

type IngestCoreResult = {
  ok: true;
  inserted: number;
  expanded: number;
  revised: number;
  duplicates: number;
  tooOld: number;
  outsideSource: number;
  source: string;
  createdIds: string[];
  revisedIds: string[];
  sourceId: string;
  actor: "extension" | "worker";
  revisions: PostRevision[];
};

async function finalizeClaimedIngest(core: IngestCoreResult, guard: () => Promise<void>) {
  await guard();
  const enrichStarted = performance.now();
  const settings = await getSettings();
  const revisions = new Map(core.revisions.map(row => [row.id, row.textRevision]));
  if (core.revisedIds.length) {
    await assignProducts(core.revisedIds);
    await guard();
    await enrichPosts(core.revisedIds, [], settings, { embed: false, revisions });
  }
  if (core.createdIds.length) {
    await collapseIdenticalTexts(
      (
        await prisma.post.findMany({
          where: { id: { in: core.createdIds } },
          select: { normalizedText: true },
        })
      ).map((row) => row.normalizedText),
    );
    await guard();
    await assignProducts(core.createdIds);
    await syncDuplicateLabels(core.createdIds);
  }
  const uniqueIds = core.createdIds.length
    ? (
        await prisma.post.findMany({
          where: { id: { in: core.createdIds }, duplicateOfId: null },
          select: { id: true },
        })
      ).map((post) => post.id)
    : [];
  await guard();
  if (uniqueIds.length) await enrichPosts(uniqueIds, [], settings, { embed: false, revisions });
  await prisma.fetchLog.create({
    data: {
      sourceId: core.sourceId,
      status: "ok",
      message: `${core.actor}: ใหม่ ${uniqueIds.length} ซ้ำ ${core.duplicates + (core.createdIds.length - uniqueIds.length)}${core.tooOld ? ` เก่าเกิน ${core.tooOld}` : ""}${core.outsideSource ? ` นอกแหล่ง ${core.outsideSource}` : ""} จัดโดย rules`,
      postsFound: uniqueIds.length,
    },
  });
  recordTiming("ingest_enrich", performance.now() - enrichStarted);
  const notifyStarted = performance.now();
  if (uniqueIds.length) {
    await guard();
    await applyAutomationRules(uniqueIds);
    const ready = await prisma.post.findMany({
      where: { id: { in: uniqueIds }, duplicateOfId: null, dismissed: false },
      include: { category: true, subcategory: true, source: true },
    });
    const notices: Prisma.NotificationCreateManyInput[] = [];
    for (const post of ready) {
      if (!shouldNotify(post) || post.score < settings.notifyMinScore) continue;
      if (settings.serviceAreaNotifyOnly && !inServiceArea(post.province, settings.serviceProvinces)) continue;
      const title = post.score >= 80 ? "ลีดร้อน" : "ลีดใหม่";
      notices.push({ postId: post.id, channel: "in_app", title, body: messageFor(post), dedupeKey: `ingest:${post.id}` });
      if (shouldNotifyExternal(post)) notices.push({ postId: post.id, title, channel: "external_pending", body: "0", read: true, dedupeKey: `external:${post.id}:${title}` });
    }
    await guard();
    if (notices.length) await prisma.notification.createMany({ data: notices, skipDuplicates: true });
  }
  recordTiming("ingest_notify", performance.now() - notifyStarted);
  return uniqueIds;
}

async function finalizeIngest(core: IngestCoreResult, assertActive: () => Promise<void> = async () => undefined) {
  await runPostProcessing(core.revisions, async (rows, guard) => {
    await finalizeClaimedIngest({ ...core, revisions: rows,
      createdIds: rows.filter(row => row.processingState === "pending_new").map(row => row.id),
      revisedIds: rows.filter(row => row.processingState === "pending_edit").map(row => row.id),
    }, guard);
  }, assertActive);
  return (await prisma.post.findMany({ where: { id: { in: core.createdIds }, duplicateOfId: null }, select: { id: true } })).map(row => row.id);
}

/** Replays durable rule work after a crash; never creates model jobs or sends Facebook comments. */
export async function processPendingIngest(limit = 40, assertActive: () => Promise<void> = async () => undefined, deadlineMs = Date.now() + 5000) {
  if (process.env.MYBOT_PROCESS !== "worker") return 0;
  await assertActive();
  const candidates = await prisma.post.findMany({ where: pendingPostWork(), orderBy: [{ processingRetryAt: "asc" }, { id: "asc" }], take: Math.min(40, Math.max(1, limit)), select: { id: true, textRevision: true } });
  return runPostProcessing(candidates, async (rows, guard) => {
    const completed: string[] = [];
    for (const sourceId of new Set(rows.map(row => row.sourceId))) {
      if (Date.now() >= deadlineMs) break;
      const group = rows.filter(row => row.sourceId === sourceId);
      await finalizeClaimedIngest({ ok: true, inserted: group.length, expanded: 0, revised: 0, duplicates: 0, tooOld: 0, outsideSource: 0,
        source: sourceId, sourceId, actor: "worker", revisions: group,
        createdIds: group.filter(row => row.processingState === "pending_new").map(row => row.id),
        revisedIds: group.filter(row => row.processingState === "pending_edit").map(row => row.id),
      }, guard);
      completed.push(...group.map(row => row.id));
    }
    return completed;
  }, assertActive);
}

export async function ingestPosts(
  input: {
    sourceUrl: string;
    posts: IncomingPost[];
    actor: "extension" | "worker";
  },
  options: { deferFinalize?: boolean } = {},
) {
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
  const itemOutcomes = new Map<string, string>();
  for (const raw of input.posts) {
    const text = raw.text?.replace(/\u0000/g, "").trim().slice(0, 8000);
    if (!text || text.length < 4 || !raw.url) {
      if (raw.url) itemOutcomes.set(normalizeUrl(raw.url), "invalid");
      continue;
    }
    const url = normalizeUrl(raw.url);
    if (!postBelongsToSource(raw.url, source)) {
      outsideSource += 1;
      itemOutcomes.set(url, "outside_source");
      continue;
    }
    const postedAt = parseDate(raw.postedAt);
    if (!isWithinMaxAge(postedAt, settings.maxPostAgeHours)) {
      tooOld += 1;
      itemOutcomes.set(url, "too_old");
      continue;
    }
    const lead = prepareLead({ text, url: raw.url }, rules, catalog);
    prepared.push({ raw: { ...raw, text }, lead, url, postedAt });
  }

  // A transport batch can contain several observed versions of one permalink.
  // Prefer full text; among partials keep the longest, among full edits keep the latest.
  const byCaptureUrl = new Map<string, (typeof prepared)[number]>();
  for (const item of prepared) {
    const previous = byCaptureUrl.get(item.url);
    if (previous && isTruncatedText(item.raw.text) && (!isTruncatedText(previous.raw.text) || item.raw.text.length <= previous.raw.text.length)) continue;
    byCaptureUrl.set(item.url, previous ? { ...item, raw: { ...previous.raw, ...item.raw }, postedAt: item.postedAt ?? previous.postedAt } : item);
  }
  const repeatedInBatch = prepared.length - byCaptureUrl.size;
  prepared.splice(0, prepared.length, ...byCaptureUrl.values());

  const existing = prepared.length
    ? await prisma.post.findMany({
        where: {
          OR: [
            { contentHash: { in: prepared.map((item) => item.lead.hash) } },
            { sourceId: source.id, externalUrl: { in: prepared.map((item) => item.url) } },
          ],
        },
        select: { id: true, contentHash: true, externalUrl: true, text: true, sourceId: true, textRevision: true, aiProvider: true, processingState: true },
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
          processingState: old.processingState === "pending_new" ? "pending_new" : "pending_edit", processingToken: null, processingRetryAt: new Date(), processingQueuedAt: new Date(), processingError: "",
          ...(old.aiProvider === "owner" ? {} : {
            categoryId: ids.categoryId, subcategoryId: ids.subcategoryId,
            intent: marketplace ? "seller" : item.lead.intent, province: item.lead.province,
            isAd: marketplace ? false : item.lead.isAd, suggestedReply: item.lead.suggestedReply, aiProvider: "rules",
          }),
        },
      });
      if (!result.count) return false;
      return true;
    });
    if (revised) {
      if (isExpansionOf(old.text, item.raw.text)) expanded += 1;
      old.text = item.raw.text; old.contentHash = item.lead.hash; old.textRevision += 1;
      revisedIds.push(old.id);
      itemOutcomes.set(item.url, "revised");
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
  const tombstoneUrls = new Set<string>();
  for (const row of removed) {
    seenHash.add(row.contentHash);
    if (row.externalUrl) {
      seenUrl.add(row.externalUrl);
      tombstoneUrls.add(row.externalUrl);
    }
  }
  let duplicates = repeatedInBatch;
  const fresh = [];
  for (const item of prepared) {
    if (seenHash.has(item.lead.hash) || seenUrl.has(item.url)) {
      duplicates += 1;
      if (!itemOutcomes.has(item.url)) {
        itemOutcomes.set(item.url, tombstoneUrls.has(item.url) ? "tombstone" : "duplicate");
      }
      continue;
    }
    seenHash.add(item.lead.hash);
    seenUrl.add(item.url);
    fresh.push(item);
  }

  const createdIds: string[] = [];
  recordTiming("ingest_prepare", performance.now() - started);
  const storeStarted = performance.now();
  // One bounded transaction per transport-sized batch; no model queue is created.
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
        processingState: "pending_new", processingRetryAt: new Date(), processingQueuedAt: new Date(),
      };
    });
    const inserted = await prisma.$transaction(async tx => {
      await tx.post.createMany({ data, skipDuplicates: true });
      const owned = await tx.post.findMany({ where: { id: { in: data.map(row => row.id) } }, select: { id: true } });
      return owned;
    });
    const ownedIds = new Set(inserted.map(post => post.id));
    for (const row of data) {
      if (ownedIds.has(row.id)) itemOutcomes.set(row.externalUrl, "accepted");
      else {
        duplicates += 1;
        itemOutcomes.set(row.externalUrl, "duplicate");
      }
    }
    createdIds.push(...inserted.map(post => post.id));
  }
  recordTiming("ingest_store", performance.now() - storeStarted);

  const core: IngestCoreResult = {
    ok: true,
    inserted: createdIds.length,
    expanded,
    revised: revisedIds.length,
    duplicates,
    tooOld,
    outsideSource,
    source: canonicalSourceUrl(source.url),
    createdIds,
    revisedIds,
    sourceId: source.id,
    actor: input.actor,
    revisions: [...createdIds.map(id => ({ id, textRevision: 0 })), ...revisedIds.map(id => ({ id, textRevision: existing.find(row => row.id === id)!.textRevision }))],
  };
  await prisma.source.update({ where: { id: source.id }, data: { lastFetchedAt: new Date(), lastError: null, ...(input.actor === "extension" ? { lastExtensionAt: new Date() } : {}) } });
  if (input.actor === "extension") await touchExtension(source.id);
  const publicOutcomes = Object.fromEntries(itemOutcomes);

  if (options.deferFinalize) {
    return {
      ok: true as const,
      inserted: core.inserted,
      expanded: core.expanded,
      revised: core.revised,
      duplicates: core.duplicates,
      tooOld: core.tooOld,
      outsideSource: core.outsideSource,
      source: core.source,
      itemOutcomes: publicOutcomes,
      _finalize: () => finalizeIngest(core),
    };
  }

  const uniqueIds = await finalizeIngest(core);
  duplicates += createdIds.length - uniqueIds.length;
  return {
    ok: true as const,
    inserted: uniqueIds.length,
    expanded,
    revised: revisedIds.length,
    duplicates,
    tooOld,
    outsideSource,
    source: canonicalSourceUrl(source.url),
    itemOutcomes: publicOutcomes,
  };
  } finally { recordTiming("ingest", performance.now() - started); }
}

export { aiCacheKey };
