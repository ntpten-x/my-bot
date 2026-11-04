import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { postKeyFromUrl } from "@/lib/scrape-plan";

const require = createRequire(import.meta.url);
type Post = { url: string; postedAt?: string | null; text?: string };
type Run = { fresh: Post[]; found: number; stoppedBy: string };
const scrape = require(path.resolve(__dirname, "../../extension/scrape.js")) as {
  postKey(url: string): string;
  scrapeSettings(remote: unknown): { screens: number; maxAgeMs: number; maxPosts: number };
  scrollWaitMs(random?: () => number): number;
  scrapeUrl(url: string, kind: string): string;
  createRun(opts: { knownKeys?: string[]; maxAgeMs?: number; maxPosts?: number; now?: number }): Run;
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
    expect(scrape.scrapeSettings({})).toEqual({ screens: 3, maxAgeMs: 24 * 3600_000, maxPosts: 40 });
    expect(scrape.scrapeSettings({ scrollScreens: 99, maxPostsPerRun: 500, maxAgeHours: 0 })).toMatchObject({ screens: 10, maxPosts: 40, maxAgeMs: 3600_000 });
    expect(scrape.scrapeSettings({ scrollScreens: 0 }).screens).toBe(0);
    expect(scrape.scrollWaitMs(() => 0)).toBe(1500);
    expect(scrape.scrollWaitMs(() => 1)).toBe(4000);
  });

  it("opens groups chronologically and Marketplace newest first", () => {
    expect(scrape.scrapeUrl("https://www.facebook.com/groups/9", "group")).toContain("sorting_setting=CHRONOLOGICAL");
    expect(scrape.scrapeUrl("https://www.facebook.com/marketplace/bangkok/search?query=iphone", "marketplace")).toContain("sortBy=creation_time_descend");
  });

  it("keeps scrolling while posts are new and stops at the first fully known screen", () => {
    const run = scrape.createRun({ knownKeys: ["p:4", "p:5"], now: NOW });
    expect(scrape.addStep(run, [post(1), post(2)])).toBe("");
    expect(scrape.addStep(run, [post(2), post(3), post(4)])).toBe("");
    expect(scrape.addStep(run, [post(4), post(5)])).toBe("seen");
    expect(run.fresh.map((p) => scrape.postKey(p.url))).toEqual(["p:1", "p:2", "p:3"]);
    expect(run.found).toBe(5);
  });

  it("does not stop on a single known pinned post on the first screen", () => {
    const run = scrape.createRun({ knownKeys: ["p:1"], now: NOW });
    expect(scrape.addStep(run, [post(1)])).toBe("");
    expect(scrape.addStep(run, [post(2)])).toBe("");
  });

  it("stops when the new posts are all older than the max age", () => {
    const run = scrape.createRun({ maxAgeMs: 24 * 3600_000, now: NOW });
    expect(scrape.addStep(run, [post(1, 2), post(2, null)])).toBe("");
    expect(scrape.addStep(run, [post(3, 30), post(4, 50)])).toBe("old");
    expect(run.fresh).toHaveLength(2);
  });

  it("stops after two empty screens and at the per-run cap", () => {
    const run = scrape.createRun({ now: NOW });
    scrape.addStep(run, [post(1)]);
    expect(scrape.addStep(run, [post(1)])).toBe("");
    expect(scrape.addStep(run, [])).toBe("end");

    const capped = scrape.createRun({ maxPosts: 40, now: NOW });
    const many = Array.from({ length: 45 }, (_, i) => post(i + 1));
    expect(scrape.addStep(capped, many)).toBe("cap");
    expect(capped.fresh).toHaveLength(40);
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
