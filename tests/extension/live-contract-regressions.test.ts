import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ ingest: vi.fn() }));
vi.mock("../../src/lib/auth", () => ({ requireExtensionToken: async () => true }));
vi.mock("../../src/lib/ingest", () => ({ ingestPosts: mocks.ingest }));
vi.mock("../../src/lib/extension-heartbeat", () => ({ countCapturedPosts: async () => undefined, noteBadExtensionToken: async () => undefined }));
import { POST } from "../../src/app/api/v1/ingest/route";
const source = readFileSync("extension/background.js", "utf8");
const scrape = createRequire(import.meta.url)("../../extension/scrape.js");
const post = (id: number) => ({ url: `https://www.facebook.com/groups/12345/posts/${id}/`, text: "synthetic post" });
beforeEach(() => { vi.clearAllMocks(); mocks.ingest.mockImplementation(async ({ posts }) => ({ ok: true, inserted: posts.length })); });
it("batches collected posts so every request is accepted by the real ingest validator", async () => {
  const statuses: number[] = [];
  const posts = Array.from({ length: 120 }, (_, i) => post(i + 1));
  const queued: Record<string, {inserted:number}> = {};
  const context = vm.createContext({ Date, Set, Map, activeReaderTabs: new Set(), sourceKind: () => "marketplace", scrapeSettingsFor: async () => scrape.scrapeSettings({}),
    base: () => "https://owner.example", currentFbUserId: async () => "12345", loadContinuation: async () => null, recoveryKey: () => "synthetic",
    loadConfig: async () => ({}), quietReason: async () => "", saveContinuation: async () => {}, finishContinuation: async () => {}, setReadingStatus: async () => {}, heartbeat: async () => {},
    chrome: { storage: { local: { get: async () => ({ sweeps: {} }), set: async () => undefined } }, windows: { get: async () => ({ state: "minimized" }) }, runtime: { getManifest: () => ({ version: "synthetic" }) } },
    MyBotScrape: {
      ...scrape,
      planRun: () => ({ mode: "normal", maxScrolls: 20, maxPosts: 200 }),
      scrapeUrl: () => "https://www.facebook.com/groups/12345",
      feedBudgetMs: () => 60_000,
      shouldKeepAwake: () => false,
      shouldHoldForeground: () => false,
      shouldPulseWake: () => false,
      isDeepMode: () => false,
      runStats: () => ({ scrolls: 0, hitLimit: false, reachedKnownPost: true, newCount: 120 }),
      isShallowRun: () => false,
      MIN_FOUND_BEFORE_END: 3,
    },
    openReader: async () => ({ windowId: 1, tabId: 2 }), closeReader: async () => undefined, parkOffscreen: async () => undefined, readerWindowState: () => "minimized",
    readFeed: async () => ({ fresh: posts, seen: new Set(posts.map(p => scrape.postKey(p.url))), found: posts.length, newCount: posts.length, steps: 1, stalls: 0, stoppedBy: "cap" }), cleanPost: (value: unknown) => value,
    queueOutbox: async ({ sourceUrl, posts: batch }: {sourceUrl:string;posts:unknown[]}) => {
      const result = await POST(new Request("https://owner.example/api/v1/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceUrl, posts: batch }) }));
      statuses.push(result.status); const batchId = String(statuses.length); queued[batchId] = await result.json(); return { batchId };
    }, flushOutbox: async () => queued, postJson: async () => undefined, reportRun: async () => null, rememberError: async () => undefined,
  });
  vm.runInContext(source.slice(source.indexOf("async function scrapeGroupPass("), source.indexOf("let cycling = false;")), context);
  const result = await vm.runInContext('scrapeGroupPass({}, {url:"https://www.facebook.com/groups/12345",id:"source"}, {}, {})', context);
  expect(statuses.every(status => status === 200)).toBe(true); expect(result.newPosts).toBe(120);
  expect(mocks.ingest).toHaveBeenCalledTimes(3);
});
it("honors the local pause switch for posts read in ordinary tabs too", async () => {
  const sendPosts = vi.fn(async () => null), postJson = vi.fn(async () => undefined);
  const context = vm.createContext({ Date, recentManual: new Map(), scrapingTabs: new Set(), isScrapeWindowTab: () => false,
    loadConfig: async () => ({ token: "synthetic", paused: true }), sendPosts, postJson,
  });
  vm.runInContext(source.slice(source.indexOf("async function forwardManual("), source.indexOf("async function pollTasks(")), context);
  await vm.runInContext('forwardManual({sourceUrl:"https://www.facebook.com/groups/12345",posts:[{text:"synthetic"}]}, {})', context);
  expect(sendPosts).not.toHaveBeenCalled(); expect(postJson).not.toHaveBeenCalled();
});
it("does not echo database exceptions into the browser or extension logs", async () => {
  mocks.ingest.mockRejectedValue(new Error("synthetic-sensitive-internal-value"));
  const result = await POST(new Request("https://owner.example/api/v1/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceUrl: "https://www.facebook.com/groups/12345", posts: [post(1)] }) }));
  expect(result.status).toBe(500); expect(await result.text()).not.toContain("synthetic-sensitive-internal-value");
});
it("returns a safe retryable readiness error for missing schema", async () => {
  mocks.ingest.mockRejectedValue(Object.assign(new Error("synthetic-internal-database-detail"), { code: "P2022" }));
  const result = await POST(new Request("https://owner.example/api/v1/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceUrl: "https://www.facebook.com/groups/12345", posts: [post(1)] }) }));
  expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ code: "SCHEMA_NOT_READY" });
});
