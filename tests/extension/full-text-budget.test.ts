import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync("extension/background.js", "utf8");
function queueHarness() {
  let now = 1_000;
  class Clock extends Date { static now() { return now; } }
  const backlog: Record<string, { groupId: string; addedAt: number; tries?: number; after?: number; lastTriedAt?: number }> = { target: { groupId: "g", addedAt: 1 } };
  const read = vi.fn(async (_tab, _kind, _urls, options) => {
    now = Math.min(now + 30_000, options?.deadlineMs ?? Infinity);
    return { found: [], failed: ["target"], failures: { target: "budget" } };
  });
  const send = vi.fn(async () => { throw new Error("synthetic storage full"); });
  const store = vi.fn(async () => undefined);
  const context = vm.createContext({ Date: Clock, Math, Map, activeReaderTabs: new Set(), fullTextBudget: 10,
    chrome: { storage: { local: { get: async () => ({}), set: store } } },
    loadFullTextBacklog: async () => structuredClone(backlog),
    updateFullTextBacklog: async fn => fn(backlog), loadConfig: async () => ({ token: "same" }), base: () => "server",
    openReader: async () => ({ tabId: 1 }), closeReader: async () => {}, sourceKind: () => "group",
    readFullTexts: read, sendPosts: send, cleanPost: p => p,
  });
  vm.runInContext(source.slice(source.indexOf("async function processFullTextQueue("), source.indexOf("let cycling = false;")), context);
  return { context, read, send, store, backlog, now: () => now,
    run: options => context.processFullTextQueue({ token: "same" }, [{ id: "g" }], options) };
}

it("separates expired review history from active remaining work and age", async () => {
  const h = queueHarness(); Object.assign(h.backlog.target, { problem: "expired", addedAt: -10000000 });
  await h.run({ budgetMs: 15000 });
  expect(h.read).not.toHaveBeenCalled();
  expect(h.store).toHaveBeenCalledWith(expect.objectContaining({ fullTextMetrics: expect.objectContaining({ remaining: 0, review: 1, oldestAgeMs: 0 }) }));
  expect(h.backlog.target).toBeDefined();
});

it("passes the queue's remaining deadline to full-text reads", async () => {
  const h = queueHarness();
  await h.run({ budgetMs: 15_000 });
  expect(h.now()).toBeLessThanOrEqual(16_000);
  expect(h.backlog.target).toBeDefined();
});

it("respects a parent deadline shorter than the detail budget", async () => {
  const h = queueHarness();
  await h.run({ budgetMs: 60_000, deadlineMs: 6_000 });
  expect(h.now()).toBeLessThanOrEqual(6_000);
});

it("retains detail recovery if durable transport enqueue fails", async () => {
  const h = queueHarness();
  h.read.mockImplementation(async () => ({ found: [{ url: "target", text: "synthetic full text" }], failed: [], failures: {} }));
  await h.run({ budgetMs: 15_000 });
  expect(h.send).toHaveBeenCalled();
  expect(h.backlog.target).toBeDefined();
});

it("does not begin another read once its parent budget is exhausted", async () => {
  const h = queueHarness();
  await h.run({ budgetMs: 60_000, deadlineMs: 1_000 });
  expect(h.read).not.toHaveBeenCalled();
});

it("bounds navigation even if Chrome never answers and retains the target", async () => {
  vi.useFakeTimers();
  try {
    const context = vm.createContext({ Date, Math, setTimeout, clearTimeout, fullTextBudget: 10, FULL_TEXT_BUDGET_MS: 30_000,
      chrome: { tabs: { update: () => new Promise(() => {}) } },
      waitComplete: async () => {}, injectReaders: async () => {}, readPage: async () => ({ posts: [] }), postKey: x => x,
    });
    vm.runInContext(source.slice(source.indexOf("async function readFullTexts("), source.indexOf("async function waitForGrowth(")), context);
    const pending = context.readFullTexts(1, "group", ["target"], { deadlineMs: Date.now() + 500 });
    await vi.advanceTimersByTimeAsync(501);
    const result = await pending;
    expect(result.found).toEqual([]);
    expect(result.failed).toEqual(["target"]);
  } finally { vi.useRealTimers(); }
});
