// Pure helpers for the assisted-reply queue. MY-BOT only prepares drafts;
// the owner opens each post and presses send in Facebook themselves.

export const MAX_QUEUE_TIMES = 6;

export function parseTimes(raw: string | null | undefined) {
  const out = new Set<string>();
  for (const part of String(raw ?? "").split(/[\s,;]+/)) {
    const match = part.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    out.add(`${String(hour).padStart(2, "0")}:${match[2]}`);
  }
  return [...out].sort().slice(0, MAX_QUEUE_TIMES);
}

// Latest schedule slot that has passed today and was not built yet, e.g. "2026-11-02 09:00".
export function dueSlot(clock: { day: string; time: string }, times: string[], lastSlot: string | null) {
  const passed = times.filter((time) => time <= clock.time);
  if (!passed.length) return null;
  const slot = `${clock.day} ${passed[passed.length - 1]}`;
  if (lastSlot && lastSlot >= slot) return null;
  return slot;
}

export function randomGapMs(minMinutes: number, maxMinutes: number, rand: () => number = Math.random) {
  const low = Math.max(0, Math.min(minMinutes, maxMinutes));
  const high = Math.max(minMinutes, maxMinutes, low);
  return Math.round((low + (high - low) * rand()) * 60_000);
}

export function gapRemainingMs(nextAllowedAt: string | null | undefined, now = Date.now()) {
  if (!nextAllowedAt) return 0;
  const at = new Date(nextAllowedAt).getTime();
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

export function authorKeyOf(name: string | null | undefined) {
  return String(name ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

export type QueueCandidate = { id: string; authorKey: string; sourceId: string };

// Picks posts in priority order while enforcing every dedupe rule:
// a post is never queued twice, one author is never contacted again within the window,
// and each group gets at most `groupCap` replies per day.
export function selectQueue(
  candidates: QueueCandidate[],
  ctx: { remaining: number; groupCap: number; groupCounts: Map<string, number>; recentAuthors: Set<string>; queuedPostIds: Set<string> },
) {
  const chosen: QueueCandidate[] = [];
  const authors = new Set(ctx.recentAuthors);
  const groups = new Map(ctx.groupCounts);
  for (const item of candidates) {
    if (chosen.length >= ctx.remaining) break;
    if (ctx.queuedPostIds.has(item.id)) continue;
    if (item.authorKey && authors.has(item.authorKey)) continue;
    const used = groups.get(item.sourceId) ?? 0;
    if (used >= ctx.groupCap) continue;
    chosen.push(item);
    groups.set(item.sourceId, used + 1);
    if (item.authorKey) authors.add(item.authorKey);
  }
  return chosen;
}

export type RotatableTemplate = {
  id: string;
  categoryId: string | null;
  useCount: number;
  sortOrder: number;
  productId?: string | null;
  /** Comma-separated source ids; "" = every group. */
  sourceIds?: string;
};

export type TemplateScope = { productId?: string | null; sourceId?: string | null };

export const templateSources = (value: string | undefined | null) => String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

/**
 * How specific a template is for this post, or -1 when it does not apply.
 * group (4) + product (2) + sub-category (1.5) / category (1); 0 = "ใช้ได้ทั้งหมด".
 */
export function templateScore(template: RotatableTemplate, categoryIds: (string | null | undefined)[], scope: TemplateScope = {}) {
  const subcategoryId = categoryIds[1];
  let score = 0;
  if (template.categoryId) {
    if (subcategoryId && template.categoryId === subcategoryId) score += 1.5;
    else if (categoryIds.includes(template.categoryId)) score += 1;
    else return -1;
  }
  if (template.productId) {
    if (template.productId !== scope.productId) return -1;
    score += 2;
  }
  const sources = templateSources(template.sourceIds);
  if (sources.length) {
    if (!scope.sourceId || !sources.includes(scope.sourceId)) return -1;
    score += 4;
  }
  return score;
}

/** Thai label of the set a template comes from (shown on the card). */
export function scopeLabel(template: RotatableTemplate, names: { product?: string | null; category?: string | null } = {}) {
  const parts: string[] = [];
  if (templateSources(template.sourceIds).length) parts.push("กลุ่มนี้");
  if (template.productId) parts.push(names.product || "เกม/สินค้า");
  if (template.categoryId) parts.push(names.category || "หมวด");
  return parts.length ? parts.join(" + ") : "ทั่วไป";
}

/** Templates that apply to the post, most specific first (then least used). */
export function rankTemplates<T extends RotatableTemplate>(templates: T[], categoryIds: (string | null | undefined)[], scope: TemplateScope = {}) {
  return templates
    .map((item) => ({ item, score: templateScore(item, categoryIds, scope) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score || a.item.useCount - b.item.useCount || a.item.sortOrder - b.item.sortOrder)
    .map((row) => row.item);
}

// Rotates templates inside the most specific matching set (group+product > product > category > all):
// the least-used template of that set goes next, counting picks made in this batch.
export function pickTemplate<T extends RotatableTemplate>(templates: T[], categoryIds: (string | null | undefined)[], usage: Map<string, number>, scope: TemplateScope = {}) {
  const scored = templates.map((item) => ({ item, score: templateScore(item, categoryIds, scope) })).filter((row) => row.score >= 0);
  if (!scored.length) return null;
  const best = Math.max(...scored.map((row) => row.score));
  const pool = scored.filter((row) => row.score === best).map((row) => row.item);
  const ranked = [...pool].sort((a, b) => {
    const ua = a.useCount + (usage.get(a.id) ?? 0);
    const ub = b.useCount + (usage.get(b.id) ?? 0);
    return ua - ub || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
  });
  const picked = ranked[0];
  usage.set(picked.id, (usage.get(picked.id) ?? 0) + 1);
  return picked;
}

export type AdvanceInput = {
  hasNext: boolean;
  hasOpen: boolean;
  openedToday: number;
  cap: number;
  waitMs: number;
};
export type AdvanceDecision =
  | { state: "ready"; waitMs: 0 }
  | { state: "wait"; waitMs: number }
  | { state: "blocked"; waitMs: 0; reason: "empty" | "cap" | "open" };

// Whether the next queued lead may be opened now, later (after the gap), or not today.
// Order matters: the cap and an item still waiting for "sent/skip" win over the gap timer.
export function advanceDecision(input: AdvanceInput): AdvanceDecision {
  if (input.hasOpen) return { state: "blocked", waitMs: 0, reason: "open" };
  if (input.openedToday >= input.cap) return { state: "blocked", waitMs: 0, reason: "cap" };
  if (!input.hasNext) return { state: "blocked", waitMs: 0, reason: "empty" };
  if (input.waitMs > 0) return { state: "wait", waitMs: input.waitMs };
  return { state: "ready", waitMs: 0 };
}

export const ADVANCE_REASON_TH: Record<"empty" | "cap" | "open", string> = {
  empty: "คิววันนี้หมดแล้ว",
  cap: "ครบโควตาตอบวันนี้แล้ว",
  open: "ยังมีรายการที่เปิดค้าง รอกด ส่งแล้ว หรือ ข้าม",
};
