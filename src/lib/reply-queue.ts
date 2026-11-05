import { prisma } from "./prisma";
import { getSettings, upsertSettings } from "./settings";
import { bangkokClock } from "./smart/summary";
import { dispatchNotification } from "./notify";
import { inServiceArea } from "./service-area";
import { renderTemplate } from "./templates";
import { followUpDate, queueRuleFor, sortQueueRules, splitList } from "./automation";
import type { AppSettings } from "./settings";
import { workerLog } from "./log";
import { ADVANCE_REASON_TH, advanceDecision, authorKeyOf, dueSlot, gapRemainingMs, pickTemplate, randomGapMs, rankTemplates, selectQueue } from "./reply-queue-core";

const NEXT_KEY = "reply_next_allowed_at";
const SLOT_KEY = "reply_queue_last_slot";
const APP_BASE = (process.env.APP_BASE_URL || "http://localhost:8001").replace(/\/$/, "");

export class ReplyQueueError extends Error {
  constructor(message: string, public status = 409, public waitMs = 0) {
    super(message);
  }
}

async function readSetting(key: string) {
  return (await prisma.setting.findUnique({ where: { key } }))?.value ?? null;
}

type QueueRule = Awaited<ReturnType<typeof loadQueueRules>>[number];
type TemplateRow = Awaited<ReturnType<typeof prisma.replyTemplate.findMany>>[number];

/** Enabled "กฎการเม้น" rules (actionQueue), in priority order. */
export async function loadQueueRules() {
  return sortQueueRules(await prisma.automationRule.findMany({ where: { enabled: true, actionQueue: true } }));
}

/**
 * Posts the queue may take right now. With comment rules: only posts a rule matches (first
 * rule by priority wins). Without rules: the default filters (buyer, min score, last 24 h).
 * Read-only; also used for the dry-run preview.
 */
export async function queueCandidates(settings: AppSettings, rules: QueueRule[], now = Date.now()) {
  const ruleMode = rules.length > 0;
  const hours = ruleMode ? Math.min(168, Math.max(24, ...rules.map((rule) => rule.maxAgeHours || 24))) : 24;
  const posts = await prisma.post.findMany({
    where: {
      createdAt: { gte: new Date(now - hours * 3_600_000) },
      dismissed: false,
      isAd: false,
      forbiddenHit: false,
      duplicateOfId: null,
      ...(ruleMode ? {} : { intent: "buyer", score: { gte: settings.replyMinScore } }),
      repliedAt: null,
      pipelineStatus: { in: ["none", "following"] },
      replyItem: { is: null },
    },
    include: { source: { select: { name: true } }, category: { select: { name: true } }, subcategory: { select: { name: true } }, product: { select: { name: true } } },
    relationLoadStrategy: "join",
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  const area = settings.serviceAreaNotifyOnly ? settings.serviceProvinces : [];
  const inArea = posts.filter((post) => inServiceArea(post.province, area));
  if (ruleMode) {
    const order = new Map(rules.map((rule, index) => [rule.id, index]));
    return inArea
      .map((post) => ({ post, rule: queueRuleFor(rules, post, now) }))
      .filter((row): row is { post: (typeof inArea)[number]; rule: QueueRule } => row.rule !== null)
      .sort((a, b) => order.get(a.rule.id)! - order.get(b.rule.id)! || b.post.score - a.post.score);
  }
  const hits = await prisma.ruleHit.findMany({ where: { postId: { in: inArea.map((post) => post.id) } }, select: { postId: true } });
  const ruleHit = new Set(hits.map((row) => row.postId));
  inArea.sort((a, b) => Number(ruleHit.has(b.id)) - Number(ruleHit.has(a.id)) || b.score - a.score);
  return inArea.map((post) => ({ post, rule: null as QueueRule | null }));
}

/** Rule's explicit templates (rotated, least used) or the best group/product-scoped set. */
export function chooseTemplate(
  templates: TemplateRow[],
  post: { categoryId: string | null; subcategoryId: string | null; productId: string | null; sourceId: string },
  rule: { templateIds: string; templateId: string | null } | null,
  usage: Map<string, number>,
) {
  const explicit = rule ? splitList(rule.templateIds) : [];
  if (!explicit.length && rule?.templateId) explicit.push(rule.templateId);
  const pool = templates.filter((item) => explicit.includes(item.id));
  if (pool.length) {
    const picked = pickTemplate(pool.map((item) => ({ ...item, categoryId: null, productId: null, sourceIds: "" })), [], usage);
    return pool.find((item) => item.id === picked?.id) ?? null;
  }
  return pickTemplate(templates, [post.categoryId, post.subcategoryId], usage, { productId: post.productId, sourceId: post.sourceId });
}

/** Per rule: matched today (RuleHit since Bangkok midnight), today's queue by status, eligible right now. */
export async function ruleQueueStats() {
  const day = bangkokClock().day;
  const midnight = new Date(`${day}T00:00:00+07:00`);
  const [settings, rules, hits, items] = await Promise.all([
    getSettings(),
    loadQueueRules(),
    prisma.ruleHit.groupBy({ by: ["ruleId"], where: { createdAt: { gte: midnight } }, _count: { _all: true } }),
    prisma.replyQueueItem.groupBy({ by: ["ruleId", "status"], where: { day, ruleId: { not: null } }, _count: { _all: true } }),
  ]);
  const candidates = rules.length ? await queueCandidates(settings, rules) : [];
  const stats: Record<string, { matchedToday: number; queued: number; opened: number; sent: number; skipped: number; eligibleNow: number }> = {};
  const row = (id: string) => (stats[id] ??= { matchedToday: 0, queued: 0, opened: 0, sent: 0, skipped: 0, eligibleNow: 0 });
  for (const hit of hits) row(hit.ruleId).matchedToday = hit._count._all;
  for (const item of items) {
    const key = item.status as "queued" | "opened" | "sent" | "skipped";
    if (item.ruleId && key in row(item.ruleId)) row(item.ruleId)[key] = item._count._all;
  }
  for (const candidate of candidates) if (candidate.rule) row(candidate.rule.id).eligibleNow += 1;
  return stats;
}

// Builds today's queue of leads with filled drafts. Nothing is ever posted from here.
export async function buildReplyQueue(options: { notify?: boolean } = {}) {
  const settings = await getSettings();
  const day = bangkokClock().day;
  const already = await prisma.replyQueueItem.findMany({ where: { day }, select: { sourceId: true } });
  const remaining = settings.replyDailyCap - already.length;
  if (remaining <= 0) return { created: 0, reason: "ครบโควตาวันนี้แล้ว" };

  const authorSince = new Date(Date.now() - settings.replyAuthorDays * 86_400_000);
  const rules = await loadQueueRules();
  const candidates = await queueCandidates(settings, rules);
  const inArea = candidates.map((row) => row.post);
  const ruleOf = new Map(candidates.map((row) => [row.post.id, row.rule]));

  const [recentItems, recentReplies] = await Promise.all([
    prisma.replyQueueItem.findMany({ where: { createdAt: { gte: authorSince }, authorKey: { not: "" } }, select: { authorKey: true } }),
    prisma.post.findMany({ where: { repliedAt: { gte: authorSince } }, select: { authorName: true } }),
  ]);
  const recentAuthors = new Set([...recentItems.map((row) => row.authorKey), ...recentReplies.map((row) => authorKeyOf(row.authorName))].filter(Boolean));
  const groupCounts = new Map<string, number>();
  for (const row of already) groupCounts.set(row.sourceId, (groupCounts.get(row.sourceId) ?? 0) + 1);

  const byId = new Map(inArea.map((post) => [post.id, post]));
  const picked = selectQueue(
    inArea.map((post) => ({ id: post.id, authorKey: settings.replyAuthorDays > 0 ? authorKeyOf(post.authorName) : "", sourceId: post.sourceId })),
    { remaining, groupCap: settings.replyGroupDailyCap, groupCounts, recentAuthors, queuedPostIds: new Set() },
  );
  const templates = await prisma.replyTemplate.findMany();
  const usage = new Map<string, number>();
  const created: { id: string; author: string; source: string }[] = [];
  for (const choice of picked) {
    const post = byId.get(choice.id)!;
    const rule = ruleOf.get(post.id) ?? null;
    const template = chooseTemplate(templates, post, rule, usage);
    const text = template
      ? renderTemplate(template.body, {
          author: post.authorName,
          category: post.category?.name,
          subcategory: post.subcategory?.name,
          province: post.province,
          source: post.source?.name,
          product: post.product?.name,
        })
      : post.suggestedReply.trim();
    if (!text) continue;
    try {
      const item = await prisma.replyQueueItem.create({
        data: { postId: post.id, sourceId: post.sourceId, authorKey: authorKeyOf(post.authorName), templateId: template?.id ?? null, ruleId: rule?.id ?? null, text, day },
      });
      created.push({ id: item.id, author: post.authorName || "ไม่ทราบชื่อ", source: post.source?.name ?? "" });
    } catch {
      // unique(postId): another build already queued it
    }
  }
  if (created.length && options.notify !== false) {
    const lines = created.slice(0, 10).map((row, index) => `${index + 1}. ${row.author}${row.source ? ` · ${row.source}` : ""}`);
    await dispatchNotification(
      {
        id: null,
        text: `มีลีดพร้อมข้อความตอบ ${created.length} รายการ — เปิดทีละโพสต์แล้วกดส่งเอง\n${lines.join("\n")}`,
        externalUrl: `${APP_BASE}/automation#reply-queue`,
        intent: "buyer",
        province: null,
        category: { name: "คิวตอบลีด" },
        source: { name: "MY-BOT" },
      },
      settings,
      `คิวตอบลีด ${created.length} รายการ`,
      { external: true, forceExternal: true, discordMode: "embed" },
    ).catch((error) => workerLog({ level: "error", message: "แจ้งคิวตอบลีดไม่สำเร็จ", error: String(error).slice(0, 300) }));
  }
  return { created: created.length, reason: created.length ? "" : "ไม่มีลีดที่ผ่านเงื่อนไข" };
}

export async function maybeBuildScheduledReplyQueue() {
  const settings = await getSettings();
  if (!settings.replyQueueEnabled || !settings.replyQueueTimes.length) return null;
  const slot = dueSlot(bangkokClock(), settings.replyQueueTimes, await readSetting(SLOT_KEY));
  if (!slot) return null;
  await upsertSettings({ [SLOT_KEY]: slot });
  const result = await buildReplyQueue();
  await workerLog({ message: `สร้างคิวตอบลีดรอบ ${slot}: ${result.created} รายการ${result.reason ? ` (${result.reason})` : ""}` });
  return result;
}

export async function replyQueueState() {
  const day = bangkokClock().day;
  const yesterday = bangkokClock(new Date(Date.now() - 86_400_000)).day;
  const [settings, items, nextAllowedAt, openedToday] = await Promise.all([getSettings(), prisma.replyQueueItem.findMany({
    where: { OR: [{ day }, { day: yesterday, status: { in: ["queued", "opened"] } }] },
    include: { post: { select: { externalUrl: true, authorName: true, text: true, score: true, province: true, source: { select: { name: true } } } } },
    relationLoadStrategy: "join",
    orderBy: [{ createdAt: "asc" }],
    take: 200,
  }), readSetting(NEXT_KEY), countOpenedToday(day)]);
  const ruleIds = [...new Set(items.map((item) => item.ruleId).filter((id): id is string => Boolean(id)))];
  const ruleNames = new Map(
    (ruleIds.length ? await prisma.automationRule.findMany({ where: { id: { in: ruleIds } }, select: { id: true, name: true } }) : []).map((rule) => [rule.id, rule.name]),
  );
  return {
    items: items.map((item) => ({
      id: item.id,
      postId: item.postId,
      status: item.status,
      text: item.text,
      day: item.day,
      openedAt: item.openedAt?.toISOString() ?? null,
      sentAt: item.sentAt?.toISOString() ?? null,
      url: item.post.externalUrl,
      authorName: item.post.authorName,
      source: item.post.source?.name ?? "",
      score: item.post.score,
      province: item.post.province,
      snippet: item.post.text.slice(0, 160),
      ruleName: item.ruleId ? ruleNames.get(item.ruleId) ?? "" : "",
    })),
    openedToday,
    cap: settings.replyDailyCap,
    nextAllowedAt: gapRemainingMs(nextAllowedAt) > 0 ? nextAllowedAt : null,
  };
}

// Replies opened since Bangkok midnight, whichever day the item was queued.
function countOpenedToday(day: string) {
  return prisma.replyQueueItem.count({ where: { openedAt: { gte: new Date(`${day}T00:00:00+07:00`) } } });
}

// Owner clicked "open next": enforce the daily cap and the randomized gap, then hand back the draft.
export async function openReplyItem(id: string) {
  const settings = await getSettings();
  const item = await prisma.replyQueueItem.findUnique({ where: { id }, include: { post: { select: { externalUrl: true } } } });
  if (!item) throw new ReplyQueueError("ไม่พบรายการ", 404);
  if (item.status !== "queued" && item.status !== "opened") throw new ReplyQueueError("รายการนี้ปิดไปแล้ว");
  if (item.status === "queued") {
    const wait = gapRemainingMs(await readSetting(NEXT_KEY));
    if (wait > 0) throw new ReplyQueueError(`รออีก ${Math.ceil(wait / 60_000)} นาทีค่อยเปิดรายการถัดไป`, 429, wait);
    const day = bangkokClock().day;
    const opened = await countOpenedToday(day);
    if (opened >= settings.replyDailyCap) throw new ReplyQueueError("ครบโควตาตอบวันนี้แล้ว");
    const next = new Date(Date.now() + randomGapMs(settings.replyGapMinMinutes, settings.replyGapMaxMinutes));
    await prisma.replyQueueItem.update({ where: { id }, data: { status: "opened", openedAt: new Date() } });
    await upsertSettings({ [NEXT_KEY]: next.toISOString() });
    if (item.templateId) await prisma.replyTemplate.updateMany({ where: { id: item.templateId }, data: { useCount: { increment: 1 } } });
  }
  return { id: item.id, postId: item.postId, url: item.post.externalUrl, text: item.text };
}

export async function markPostReplied(postId: string) {
  const settings = await getSettings();
  const now = new Date();
  await prisma.post.update({
    where: { id: postId },
    data: { pipelineStatus: "replied", repliedAt: now, statusChangedAt: now, isSaved: true, followUpAt: followUpDate(settings.followUpDays, now) },
  });
  await prisma.replyQueueItem.updateMany({ where: { postId, status: { in: ["queued", "opened"] } }, data: { status: "sent", sentAt: now } });
}

export async function finishReplyItem(id: string, action: "sent" | "skip", text?: string) {
  const item = await prisma.replyQueueItem.findUnique({ where: { id } });
  if (!item) throw new ReplyQueueError("ไม่พบรายการ", 404);
  const finalText = text?.trim();
  if (finalText && finalText !== item.text) await prisma.replyQueueItem.update({ where: { id }, data: { text: finalText.slice(0, 2000) } });
  // Already closed (e.g. marked from the Facebook tab and then from the panel): nothing to do.
  if (item.status === "sent" || item.status === "skipped") return;
  if (action === "sent") await markPostReplied(item.postId);
  else await prisma.replyQueueItem.update({ where: { id }, data: { status: "skipped" } });
}

// Owner edited the draft before inserting it.
export async function editReplyItem(id: string, text: string) {
  const item = await prisma.replyQueueItem.findUnique({ where: { id } });
  if (!item) throw new ReplyQueueError("ไม่พบรายการ", 404);
  if (item.status === "sent" || item.status === "skipped") throw new ReplyQueueError("รายการนี้ปิดไปแล้ว");
  const value = text.trim().slice(0, 2000);
  if (!value) throw new ReplyQueueError("ข้อความว่าง", 400);
  await prisma.replyQueueItem.update({ where: { id }, data: { text: value } });
  return { id, text: value };
}

export type ReplyPrefs = { autoAdvance: boolean; autoMarkSent: boolean; autoInsert: boolean };

function activeWindow() {
  const day = bangkokClock().day;
  const yesterday = bangkokClock(new Date(Date.now() - 86_400_000)).day;
  return { day, where: { day: { in: [day, yesterday] } } };
}

// What auto-advance should do next: open now, wait for the gap, or stop (cap, empty queue, item still open).
export async function replyAdvanceInfo() {
  const settings = await getSettings();
  const { day, where } = activeWindow();
  const [next, open, openedToday, nextAllowedAt] = await Promise.all([
    prisma.replyQueueItem.findFirst({ where: { ...where, status: "queued", post: { repliedAt: null, dismissed: false } }, orderBy: { createdAt: "asc" }, select: { id: true } }),
    prisma.replyQueueItem.findFirst({ where: { ...where, status: "opened" }, select: { id: true } }),
    countOpenedToday(day),
    readSetting(NEXT_KEY),
  ]);
  const waitMs = gapRemainingMs(nextAllowedAt);
  const decision = advanceDecision({ hasNext: Boolean(next), hasOpen: Boolean(open), openedToday, cap: settings.replyDailyCap, waitMs });
  return {
    // "ready" | "wait" | "open" | "cap" | "empty"
    decision: decision.state === "blocked" ? decision.reason : decision.state,
    waitMs: decision.waitMs,
    reason: decision.state === "blocked" ? ADVANCE_REASON_TH[decision.reason] : "",
    nextId: next?.id ?? null,
    openId: open?.id ?? null,
    openedToday,
    cap: settings.replyDailyCap,
    prefs: { autoAdvance: settings.replyAutoAdvance, autoMarkSent: settings.replyAutoMarkSent, autoInsert: settings.replyAutoInsert } as ReplyPrefs,
  };
}

export type ReplyTemplateOption = { id: string; name: string; text: string };

// Every template that fits this post, already filled in, so the overlay can switch drafts.
export async function replyTemplatesForPost(postId: string): Promise<ReplyTemplateOption[]> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      authorName: true,
      province: true,
      categoryId: true,
      subcategoryId: true,
      productId: true,
      sourceId: true,
      category: { select: { name: true } },
      subcategory: { select: { name: true } },
      source: { select: { name: true } },
      product: { select: { name: true } },
    },
  });
  if (!post) return [];
  const templates = await prisma.replyTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  // Most specific set first (group+product > product > category > all).
  return rankTemplates(templates, [post.categoryId, post.subcategoryId], { productId: post.productId, sourceId: post.sourceId })
    .slice(0, 20)
    .map((template) => ({
      id: template.id,
      name: template.name,
      text: renderTemplate(template.body, {
        author: post.authorName,
        category: post.category?.name,
        subcategory: post.subcategory?.name,
        province: post.province,
        source: post.source?.name,
        product: post.product?.name,
      }).slice(0, 2000),
    }))
    .filter((option) => option.text);
}

// Auto-advance: opens the oldest queued lead if the cap, gap and dedupe rules allow it.
// Leads that were already answered some other way are skipped instead of reopened.
export async function openNextReplyItem() {
  const info = await replyAdvanceInfo();
  if (info.decision !== "ready" || !info.nextId) return { item: null, ...info };
  const { where } = activeWindow();
  await prisma.replyQueueItem.updateMany({
    where: { ...where, status: "queued", post: { OR: [{ repliedAt: { not: null } }, { dismissed: true }] } },
    data: { status: "skipped" },
  });
  try {
    const item = await openReplyItem(info.nextId);
    return { item: { ...item, templates: await replyTemplatesForPost(item.postId) }, ...(await replyAdvanceInfo()) };
  } catch (err) {
    if (err instanceof ReplyQueueError) return { item: null, ...(await replyAdvanceInfo()), reason: err.message };
    throw err;
  }
}

