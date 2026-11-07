import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { postKeyFromUrl } from "@/lib/scrape-plan";

const require = createRequire(import.meta.url);
type Post = { url: string; postedAt?: string | null; text?: string };
type Run = { fresh: Post[]; found: number; stoppedBy: string };
type Plan = { mode: string; maxAgeMs: number; maxScrolls: number; knownStreak: number; maxPosts: number };
const scrape = require(path.resolve(__dirname, "../../extension/scrape.js")) as {
  postKey(url: string): string;
  scrapeSettings(remote: unknown): { screens: number; maxAgeMs: number; maxPosts: number };
  scrollWaitMs(random?: () => number): number;
  scrapeUrl(url: string, kind: string): string;
  createRun(opts: { knownKeys?: string[]; maxAgeMs?: number; maxPosts?: number; maxScrolls?: number; knownStreak?: number; mode?: string; now?: number }): Run;
  planRun(opts: { now?: number; group?: Record<string, unknown>; lastSweepAt?: number; audit?: boolean }): Plan;
  runStats(run: Run): { reachedKnownPost: boolean; hitLimit: boolean; scrolls: number; newCount: number };
  addStep(run: Run, posts: Post[]): string;
  cleanupText(text: string): string;
};

const NOW = Date.parse("2026-11-04T12:00:00+07:00");
const post = (id: number, hoursAgo: number | null = 1): Post => ({
  url: `https://www.facebook.com/groups/9/posts/${id}/`,
  postedAt: hoursAgo === null ? null : new Date(NOW - hoursAgo * 3600_000).toISOString(),
});

describe("scroll scrape plan (extension/scrape.js)", () => {
  it("uses the same post keys as the server", () => {
    const urls = [
      "https://www.facebook.com/groups/1/posts/123/?comment_id=5",
      "https://web.facebook.com/groups/1/permalink/456/",
      "https://www.facebook.com/permalink.php?story_fbid=789&id=1",
      "https://www.facebook.com/groups/1/?multi_permalinks=111,222",
      "https://www.facebook.com/marketplace/item/555/?ref=search",
      "https://m.facebook.com/Some.Page/videos/abc/",
    ];
    for (const url of urls) expect(scrape.postKey(url)).toBe(postKeyFromUrl(url));
    expect(scrape.postKey(urls[4])).toBe("mp:555");
  });

  it("clamps settings and waits 1.5–4 s between screens", () => {
    expect(scrape.scrapeSettings({})).toEqual({ screens: 3, maxAgeMs: 24 * 3600_000, maxPosts: 200 });
    expect(scrape.scrapeSettings({ scrollScreens: 99, maxPostsPerRun: 500, maxAgeHours: 0 })).toMatchObject({ screens: 10, maxPosts: 200, maxAgeMs: 3600_000 });
    expect(scrape.scrapeSettings({ scrollScreens: 0 }).screens).toBe(0);
    expect(scrape.scrollWaitMs(() => 0)).toBe(1500);
    expect(scrape.scrollWaitMs(() => 1)).toBe(4000);
  });

  it("opens groups chronologically and Marketplace newest first", () => {
    expect(scrape.scrapeUrl("https://www.facebook.com/groups/9", "group")).toContain("sorting_setting=CHRONOLOGICAL");
    expect(scrape.scrapeUrl("https://www.facebook.com/marketplace/bangkok/search?query=iphone", "marketplace")).toContain("sortBy=creation_time_descend");
  });

  it("keeps scrolling past one known pinned post and stops after 3 known posts in a row", () => {
    const run = scrape.createRun({ knownKeys: ["p:1", "p:7", "p:8", "p:9"], now: NOW });
    // p:1 is a pinned/featured known post above new ones: it must not stop the run.
    expect(scrape.addStep(run, [post(1), post(2), post(3)])).toBe("");
    expect(scrape.addStep(run, [post(4), post(5), post(6)])).toBe("");
    expect(scrape.addStep(run, [post(7), post(8)])).toBe("");
    expect(scrape.addStep(run, [post(9), post(10)])).toBe("seen");
    expect(run.fresh.map((p) => scrape.postKey(p.url))).toEqual(["p:2", "p:3", "p:4", "p:5", "p:6"]);
    expect(scrape.runStats(run)).toMatchObject({ reachedKnownPost: true, hitLimit: false, newCount: 5, scrolls: 3 });
  });

  it("a known post between new ones resets the streak", () => {
    const run = scrape.createRun({ knownKeys: ["p:2", "p:3", "p:5", "p:6", "p:7"], now: NOW });
    expect(scrape.addStep(run, [post(1), post(2), post(3), post(4)])).toBe("");
    expect(scrape.addStep(run, [post(5), post(6), post(7)])).toBe("seen");
    expect(run.fresh).toHaveLength(2);
  });

  it("does not stop on one out-of-order old post, only on 3 old posts in a row", () => {
    const run = scrape.createRun({ maxAgeMs: 24 * 3600_000, now: NOW });
    expect(scrape.addStep(run, [post(1, 2), post(2, 50), post(3, 3)])).toBe("");
    expect(scrape.addStep(run, [post(4, 30), post(5, 40)])).toBe("");
    expect(scrape.addStep(run, [post(6, 60)])).toBe("old");
    expect(run.fresh.map((p) => scrape.postKey(p.url))).toEqual(["p:1", "p:3"]);
  });

  it("has no 40-post cap: keeps going while new posts appear, up to the sane bound", () => {
    const run = scrape.createRun({ now: NOW });
    expect(scrape.addStep(run, Array.from({ length: 60 }, (_, i) => post(i + 1)))).toBe("");
    expect(run.fresh).toHaveLength(60);
    const capped = scrape.createRun({ now: NOW });
    expect(scrape.addStep(capped, Array.from({ length: 250 }, (_, i) => post(i + 1)))).toBe("cap");
    expect(capped.fresh).toHaveLength(200);
    expect(scrape.runStats(capped)).toMatchObject({ hitLimit: true, reachedKnownPost: false });
  });

  it("stops at the scroll budget and after empty screens (colder while the feed is still thin)", () => {
    const run = scrape.createRun({ maxScrolls: 2, now: NOW });
    expect(scrape.addStep(run, [post(1)])).toBe("");
    expect(scrape.addStep(run, [post(2)])).toBe("");
    expect(scrape.addStep(run, [post(3)])).toBe("limit"); // first screen + 2 scrolls
    expect(scrape.runStats(run).hitLimit).toBe(true);

    // found < MIN_FOUND_BEFORE_END → need COLD_EMPTY_STREAK empty screens
    const thin = scrape.createRun({ now: NOW });
    scrape.addStep(thin, [post(1)]);
    expect(scrape.emptyBudget(thin)).toBe(scrape.COLD_EMPTY_STREAK);
    for (let i = 0; i < scrape.COLD_EMPTY_STREAK - 1; i += 1) {
      expect(scrape.addStep(thin, [])).toBe("");
    }
    expect(scrape.addStep(thin, [])).toBe("end");

    // Enough distinct posts → normal EMPTY_STREAK
    const full = scrape.createRun({ now: NOW });
    scrape.addStep(full, [post(1), post(2), post(3)]);
    expect(scrape.emptyBudget(full)).toBe(scrape.EMPTY_STREAK);
    for (let i = 0; i < scrape.EMPTY_STREAK - 1; i += 1) {
      expect(scrape.addStep(full, [])).toBe("");
    }
    expect(scrape.addStep(full, [])).toBe("end");
  });

  it("plans normal runs, hourly sweeps, 24 h catch-up and audits", () => {
    const recent = new Date(NOW - 10 * 60_000).toISOString();
    expect(scrape.planRun({ now: NOW, group: { lastFetchedAt: recent, intervalMinutes: 15 }, lastSweepAt: NOW - 5 * 60_000 })).toMatchObject({ mode: "normal", knownStreak: 3, maxScrolls: 20, maxPosts: 200 });
    expect(scrape.planRun({ now: NOW, group: { lastFetchedAt: recent, intervalMinutes: 15 }, lastSweepAt: NOW - 61 * 60_000 })).toMatchObject({ mode: "sweep", maxScrolls: 30, maxAgeMs: 24 * 3600_000 });
    // Chrome was closed for 30 h: still capped at 24 h (owner rule).
    const closed = scrape.planRun({ now: NOW, group: { lastFetchedAt: new Date(NOW - 30 * 3600_000).toISOString(), lastSeenAt: new Date(NOW - 31 * 3600_000).toISOString() } });
    expect(closed).toMatchObject({ mode: "catchup", maxScrolls: 30, knownStreak: 3 });
    expect(closed.maxAgeMs).toBe(24 * 3600_000);
    const week = scrape.planRun({ now: NOW, group: { lastFetchedAt: new Date(NOW - 7 * 24 * 3600_000).toISOString() } });
    expect(week.maxAgeMs).toBe(24 * 3600_000);
    expect(scrape.planRun({ now: NOW, group: {} }).mode).toBe("catchup");
    const audit = scrape.planRun({ now: NOW, group: { lastFetchedAt: recent }, audit: true });
    expect(audit).toMatchObject({ mode: "audit", knownStreak: Infinity, maxAgeMs: 24 * 3600_000 });
  });

  it("catch-up stops on posts older than 24 h instead of reading further back", () => {
    const plan = scrape.planRun({ now: NOW, group: { lastFetchedAt: new Date(NOW - 40 * 3600_000).toISOString(), lastSeenAt: new Date(NOW - 41 * 3600_000).toISOString() } });
    const run = scrape.createRun({ knownKeys: ["p:8", "p:9", "p:10"], now: NOW, ...plan });
    expect(scrape.addStep(run, [post(1, 1), post(2, 10), post(3, 20)])).toBe("");
    expect(scrape.addStep(run, [post(4, 25), post(5, 26), post(6, 27)])).toBe("old");
    expect(run.fresh).toHaveLength(3);
  });

  it("an audit never stops on known posts", () => {
    const run = scrape.createRun({ knownKeys: ["p:1", "p:2", "p:3", "p:4"], now: NOW, ...scrape.planRun({ now: NOW, audit: true }) });
    expect(scrape.addStep(run, [post(1), post(2), post(3), post(4), post(5)])).toBe("");
    expect(run.fresh).toHaveLength(1);
  });
  it("keeps the truncation mark when removing a trailing See more", () => {
    expect(scrape.cleanupText("หาช่างแอร์ ... ดูเพิ่มเติม")).toBe("หาช่างแอร์…");
    expect(scrape.cleanupText("สอบถามเพิ่มเติม")).toBe("สอบถามเพิ่มเติม");
  });

  it("scrolls without clicks, keys or Facebook APIs", () => {
    const src = readFileSync(path.resolve(__dirname, "../../extension/background.js"), "utf8");
    const scrollFn = src.slice(src.indexOf("async function scrollOneScreen"), src.indexOf("async function scrapeSettingsFor"));
    expect(scrollFn).toMatch(/scrollTop/);
    expect(scrollFn).not.toMatch(/click|dispatchEvent|focus\(|keydown|fetch\(/);
    expect(src).toMatch(/\/api\/v1\/extension\/scrape-result/);
    expect(src).toMatch(/scrapingTabs\.has\(sender\.tab\.id\)/);
  });
});
