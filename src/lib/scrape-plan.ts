// Scheduling for the read-only extension scrape: priority intervals, adaptive back-off,
// stable post keys (shared with extension/scrape.js) and Marketplace URL helpers.

export type SourcePriority = "high" | "normal" | "low";

export const PRIORITIES: SourcePriority[] = ["high", "normal", "low"];
export const PRIORITY_LABEL: Record<SourcePriority, string> = { high: "สูง", normal: "ปกติ", low: "ต่ำ" };
export const PRIORITY_INTERVAL: Record<SourcePriority, number> = { high: 3, normal: 10, low: 30 };
export const PRIORITY_RANK: Record<SourcePriority, number> = { high: 0, normal: 1, low: 2 };

/** Shortest adaptive interval, whatever the priority. */
export const MIN_INTERVAL_MINUTES = 2;
/** A run that finds at least this many new posts shortens the next interval. */
export const BUSY_RUN_NEW_POSTS = 5;
/**
 * Below this many posts, an "end"/"limit" stop is treated as incomplete coverage
 * (background tab failed to hydrate) — not a quiet group.
 */
export const SHALLOW_FOUND = 3;

/** True when the last scrape likely missed posts inside the 24 h window. */
export function isIncompleteScrape(input: { ok: boolean; postsFound: number; stoppedBy: string }) {
  if (!input.ok) return false;
  const stop = String(input.stoppedBy || "");
  if (stop === "seen" || stop === "old" || stop === "cap") return false;
  if ((stop === "end" || stop === "limit" || !stop) && input.postsFound < SHALLOW_FOUND) return true;
  return false;
}

export const EXTENSION_SOURCE_TYPES = ["facebook_group", "facebook_marketplace"] as const;

export function isExtensionSource(type: string) {
  return (EXTENSION_SOURCE_TYPES as readonly string[]).includes(type);
}

export function normalizePriority(value: string | null | undefined): SourcePriority {
  return value === "high" || value === "low" ? value : "normal";
}

/** Back-off ceiling: three times the configured interval (3 → 9, 10 → 30, 30 → 90), at most 180. */
export function maxIntervalFor(baseMinutes: number) {
  const base = Math.max(MIN_INTERVAL_MINUTES, baseMinutes || PRIORITY_INTERVAL.normal);
  return Math.min(180, Math.max(base, base * 3));
}

/**
 * Next interval after a run.
 * - many new posts: shorten (x0.6) down to 2 minutes
 * - a few new posts: come back to the configured interval if we had backed off
 * - incomplete shallow scrape: retry sooner (do not back off as if the group were quiet)
 * - nothing new: back off (x1.5) up to the ceiling
 * - error: keep the current interval
 */
export function nextAdaptiveInterval(input: {
  current: number;
  base: number;
  newPosts: number;
  ok: boolean;
  incomplete?: boolean;
}) {
  const base = Math.max(MIN_INTERVAL_MINUTES, input.base || PRIORITY_INTERVAL.normal);
  const max = maxIntervalFor(base);
  const current = Number.isFinite(input.current) && input.current > 0 ? input.current : base;
  let next = current;
  if (!input.ok) next = current;
  else if (input.incomplete) next = Math.min(current, Math.max(MIN_INTERVAL_MINUTES, base * 0.7));
  else if (input.newPosts >= BUSY_RUN_NEW_POSTS) next = current * 0.6;
  else if (input.newPosts > 0) next = Math.min(current, base);
  else next = current * 1.5;
  next = Math.min(max, Math.max(MIN_INTERVAL_MINUTES, next));
  return Math.round(next * 10) / 10;
}

/** Jitter never exceeds a quarter of the interval, so a 3-minute group is not pushed to 8 minutes. */
export function jitterCapMinutes(intervalMinutes: number, jitterMinutes: number) {
  return Math.max(0, Math.min(jitterMinutes, intervalMinutes * 0.25));
}

export function nextRunAfter(now: Date, intervalMinutes: number, jitterMinutes: number, random = Math.random) {
  const jitter = random() * jitterCapMinutes(intervalMinutes, jitterMinutes);
  return new Date(now.getTime() + (intervalMinutes + jitter) * 60_000);
}

export function isDue(source: { nextRunAt: Date | null }, now = Date.now()) {
  return !source.nextRunAt || source.nextRunAt.getTime() <= now;
}

/** Order due sources: priority first, then the most overdue. */
export function sortDue<T extends { priority: string; nextRunAt: Date | null }>(sources: T[]) {
  return [...sources].sort((a, b) => {
    const rank = PRIORITY_RANK[normalizePriority(a.priority)] - PRIORITY_RANK[normalizePriority(b.priority)];
    if (rank) return rank;
    return (a.nextRunAt?.getTime() ?? 0) - (b.nextRunAt?.getTime() ?? 0);
  });
}

/**
 * Stable key for a Facebook post or Marketplace listing URL. Must match postKey() in extension/scrape.js.
 */
export function postKeyFromUrl(input: string): string {
  const value = String(input || "").trim();
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value, "https://www.facebook.com");
  } catch {
    return value.toLowerCase();
  }
  const path = url.pathname;
  const item = path.match(/\/marketplace\/item\/(\d+)/i);
  if (item) return `mp:${item[1]}`;
  const post = path.match(/\/(?:posts|permalink)\/(\d+)/i);
  if (post) return `p:${post[1]}`;
  const story = url.searchParams.get("story_fbid") || url.searchParams.get("multi_permalinks");
  if (story && /^\d+$/.test(story.split(",")[0])) return `p:${story.split(",")[0]}`;
  const host = url.hostname.toLowerCase().replace(/^(m|web|www)\./, "");
  return `u:${host}${path.replace(/\/+$/, "")}`.toLowerCase();
}

// ---------- Marketplace ----------
const MARKETPLACE_KEEP_PARAMS = ["query", "minPrice", "maxPrice", "daysSinceListed", "exact", "radius"];

export function isMarketplaceUrl(input: string) {
  try {
    const url = new URL(input.trim());
    const host = url.hostname.toLowerCase();
    if (!/(^|\.)facebook\.com$/.test(host)) return false;
    return /^\/marketplace(\/|$)/i.test(url.pathname) && !/^\/marketplace\/item\//i.test(url.pathname);
  } catch {
    return false;
  }
}

/** Search or category page on facebook.com/marketplace, minus tracking and sort params, stable for matching. */
export function canonicalMarketplaceUrl(input: string) {
  const url = new URL(input.trim());
  const path = url.pathname.replace(/\/+$/, "") || "/marketplace";
  const kept = new URLSearchParams();
  for (const key of MARKETPLACE_KEEP_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return `https://www.facebook.com${path}${query ? `?${query}` : ""}`;
}

export function marketplaceSourceName(input: string) {
  try {
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    const query = url.searchParams.get("query");
    const place = parts[1] && parts[1] !== "search" && parts[1] !== "category" ? parts[1] : "";
    const category = parts[1] === "category" ? parts[2] : parts[2] && parts[2] !== "search" ? parts[2] : "";
    const what = query || category || "ทั้งหมด";
    return `Marketplace: ${decodeURIComponent(what)}${place ? ` (${decodeURIComponent(place)})` : ""}`.slice(0, 120);
  } catch {
    return "Marketplace";
  }
}
