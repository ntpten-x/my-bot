import { describe, expect, it } from "vitest";
import {
  canonicalMarketplaceUrl,
  isDue,
  isMarketplaceUrl,
  marketplaceSourceName,
  maxIntervalFor,
  isIncompleteScrape,
  nextAdaptiveInterval,
  nextRunAfter,
  normalizePriority,
  PRIORITY_INTERVAL,
  sortDue,
} from "@/lib/scrape-plan";
import { canonicalSourceUrl, defaultSourceName, detectSourceType } from "@/lib/pipeline/normalize";
import { sourceIsStale } from "@/lib/extension-health";

describe("priority + adaptive scheduling", () => {
  it("maps priorities to 3/10/30 minutes and falls back to normal", () => {
    expect(PRIORITY_INTERVAL).toEqual({ high: 3, normal: 10, low: 30 });
    expect(normalizePriority("high")).toBe("high");
    expect(normalizePriority("whatever")).toBe("normal");
    expect(normalizePriority(null)).toBe("normal");
  });

  it("speeds up on busy runs down to 2 minutes and backs off when quiet", () => {
    expect(nextAdaptiveInterval({ current: 10, base: 10, newPosts: 8, ok: true })).toBe(6);
    expect(nextAdaptiveInterval({ current: 3, base: 3, newPosts: 12, ok: true })).toBe(2);
    expect(nextAdaptiveInterval({ current: 2, base: 3, newPosts: 12, ok: true })).toBe(2);
    expect(nextAdaptiveInterval({ current: 6, base: 10, newPosts: 2, ok: true })).toBe(6);
    expect(nextAdaptiveInterval({ current: 15, base: 10, newPosts: 2, ok: true })).toBe(10);
    expect(nextAdaptiveInterval({ current: 10, base: 10, newPosts: 0, ok: true })).toBe(15);
    expect(nextAdaptiveInterval({ current: 25, base: 10, newPosts: 0, ok: true })).toBe(maxIntervalFor(10));
    expect(nextAdaptiveInterval({ current: 7, base: 10, newPosts: 0, ok: false })).toBe(7);
    // Shallow end must not look like a quiet group — retry at/near base, never back off.
    expect(isIncompleteScrape({ ok: true, postsFound: 1, stoppedBy: "end" })).toBe(true);
    expect(isIncompleteScrape({ ok: true, postsFound: 10, stoppedBy: "seen" })).toBe(false);
    expect(nextAdaptiveInterval({ current: 15, base: 10, newPosts: 0, ok: true, incomplete: true })).toBe(7);
    expect(maxIntervalFor(30)).toBe(90);
    expect(maxIntervalFor(120)).toBe(180);
  });

  it("uses seen fresh count for adaptive so insert dedupe does not fake a quiet group", () => {
    // Scraped 7 fresh posts but 0 inserted (all duplicates) → treat as busy, not quiet.
    expect(nextAdaptiveInterval({ current: 10, base: 10, newPosts: 0, seenNew: 7, ok: true })).toBe(6);
    expect(nextAdaptiveInterval({ current: 15, base: 10, newPosts: 0, seenNew: 2, ok: true })).toBe(10);
  });

  it("flags hitLimit without reaching known posts as incomplete coverage", () => {
    expect(isIncompleteScrape({ ok: true, postsFound: 9, stoppedBy: "limit", hitLimit: true, reachedKnown: false })).toBe(true);
    expect(isIncompleteScrape({ ok: true, postsFound: 9, stoppedBy: "limit", hitLimit: true, reachedKnown: true })).toBe(true);
    expect(isIncompleteScrape({ ok: true, postsFound: 9, stoppedBy: "seen", hitLimit: false, reachedKnown: true })).toBe(false);
    expect(nextAdaptiveInterval({ current: 10, base: 10, newPosts: 4, ok: true, incomplete: true })).toBe(7);
  });

  it.each(["cap", "limit", "screens", "yield", "loading", "stalled"])("keeps %s incomplete even when posts were already found", stoppedBy => {
    expect(isIncompleteScrape({ ok: true, postsFound: 200, stoppedBy, reachedKnown: true })).toBe(true);
  });

  it("schedules with bounded jitter and orders due sources by priority", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    const next = nextRunAfter(now, 4, 5, () => 1);
    expect(next.getTime() - now.getTime()).toBe(5 * 60_000);
    expect(isDue({ nextRunAt: null }, now.getTime())).toBe(true);
    expect(isDue({ nextRunAt: new Date(now.getTime() + 60_000) }, now.getTime())).toBe(false);
    const sorted = sortDue([
      { id: "low", priority: "low", nextRunAt: null },
      { id: "n-new", priority: "normal", nextRunAt: new Date("2026-11-04T09:59:00Z") },
      { id: "n-old", priority: "normal", nextRunAt: new Date("2026-11-04T09:00:00Z") },
      { id: "high", priority: "high", nextRunAt: new Date("2026-11-04T09:30:00Z") },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["high", "n-old", "n-new", "low"]);
  });

  it("does not flag a backed-off source as silent before its own interval", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    const base = { enabled: true, type: "facebook_marketplace", createdAt: new Date(now - 86_400_000) };
    expect(sourceIsStale({ ...base, lastExtensionAt: new Date(now - 60 * 60_000), currentIntervalMinutes: 90 }, now)).toBe(false);
    expect(sourceIsStale({ ...base, lastExtensionAt: new Date(now - 60 * 60_000), currentIntervalMinutes: 10 }, now)).toBe(true);
    expect(sourceIsStale({ ...base, type: "rss", lastExtensionAt: null }, now)).toBe(false);
  });
});

describe("Marketplace sources", () => {
  const url = "https://web.facebook.com/marketplace/chiangmai/search/?query=iphone%2013&sortBy=creation_time_descend&exact=false&ref=search";

  it("detects and canonicalizes search and category URLs", () => {
    expect(isMarketplaceUrl(url)).toBe(true);
    expect(isMarketplaceUrl("https://www.facebook.com/marketplace/category/vehicles")).toBe(true);
    expect(isMarketplaceUrl("https://www.facebook.com/marketplace/item/123/")).toBe(false);
    expect(isMarketplaceUrl("https://www.facebook.com/groups/1")).toBe(false);
    expect(detectSourceType(url)).toBe("facebook_marketplace");
    expect(detectSourceType("https://www.facebook.com/groups/abc")).toBe("facebook_group");
    const canonical = canonicalMarketplaceUrl(url);
    expect(canonical).toMatch(/^https:\/\/www\.facebook\.com\/marketplace\/chiangmai\/search\?/);
    expect(canonical).toContain("query=iphone");
    expect(canonical).not.toContain("sortBy");
    expect(canonical).not.toContain("ref=");
    expect(canonicalSourceUrl(url)).toBe(canonical);
    expect(canonicalSourceUrl(canonical + "&sortBy=creation_time_descend")).toBe(canonical);
  });

  it("names Marketplace sources readably", () => {
    expect(marketplaceSourceName(url)).toContain("iphone 13");
    expect(defaultSourceName(url, "facebook_marketplace")).toMatch(/^Marketplace:/);
  });
});
