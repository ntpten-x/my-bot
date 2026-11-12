import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
const source = readFileSync("extension/background.js", "utf8");
function harness() {
  let cfg = { apiBase: "https://owner.example", token: "synthetic", paused: false, accountPaused: false };
  const queue = vi.fn(async () => ({ batchId: "synthetic" }));
  const flush = vi.fn(async () => ({}));
  const context = vm.createContext({ Date, Map, Promise, manualTail: Promise.resolve(), recentManual: new Map(),
    scrapingTabs: new Set(), isScrapeWindowTab: () => false, MyBotScrape: { postKey: url => url },
    loadConfig: async () => cfg, currentFbUserId: async () => "12345", base: value => value.apiBase, queueOutbox: queue, flushOutbox: flush,
  });
  vm.runInContext(source.slice(source.indexOf("async function forwardManual("), source.indexOf("async function pollTasks(")), context);
  return { queue, flush, setConfig: (value: Partial<typeof cfg>) => { cfg = { ...cfg, ...value }; },
    hold: () => { let release!: () => void; context.manualTail = new Promise<void>(resolve => { release = resolve; }); return () => release(); },
    run: (id: number, text = "synthetic", captureScope?: object) => context.forwardManual({ captureScope, sourceUrl: "https://www.facebook.com/groups/12345", posts: [{ url: `https://www.facebook.com/groups/12345/posts/${id}/`, text }] }, {}) };
}
it("queues two new posts from the same group immediately instead of dropping the second for 20 seconds", async () => {
  const h = harness(); await h.run(1); await h.run(2);
  expect(h.queue).toHaveBeenCalledTimes(2);
  expect(h.queue.mock.calls[1][0].posts[0].url).toContain("/2/");
});
it("serializes duplicate snapshots from multiple tabs and queues one durable copy", async () => {
  const h = harness(); const results = await Promise.all([h.run(1), h.run(1)]);
  expect(h.queue).toHaveBeenCalledTimes(1);
  expect(results.map(row => row.accepted)).toEqual([true, true]);
});
it("does not acknowledge or poison dedupe when durable storage fails", async () => {
  const h = harness(); h.queue.mockRejectedValueOnce(new Error("storage full"));
  await expect(h.run(1)).rejects.toThrow("storage full");
  expect(await h.run(1)).toMatchObject({ accepted: true, queued: 1 });
  expect(h.queue).toHaveBeenCalledTimes(2);
});
it("forwards changed text and keeps dedupe scoped to the current server credentials", async () => {
  const h = harness(); await h.run(1); await h.run(1, "expanded synthetic");
  h.setConfig({ apiBase: "https://other.example" }); await h.run(1, "expanded synthetic");
  expect(h.queue).toHaveBeenCalledTimes(3);
  expect(h.queue.mock.calls[2][0].apiBase).toBe("https://other.example");
});
it("defers paused accounts without queueing or flushing", async () => {
  const h = harness(); h.setConfig({ accountPaused: true });
  expect(await h.run(1)).toMatchObject({ accepted: false, retryAfterMs: 15000 });
  expect(h.queue).not.toHaveBeenCalled();expect(h.flush).not.toHaveBeenCalled();
});
it("defers captures bound to another server or Facebook account", async () => {
  const h = harness();
  expect(await h.run(1, "synthetic", { apiBase: "https://other.example", fbUserId: "12345" })).toMatchObject({ accepted: false });
  expect(await h.run(1, "synthetic", { apiBase: "https://owner.example", fbUserId: "67890" })).toMatchObject({ accepted: false });
  expect(h.queue).not.toHaveBeenCalled();
});
it("rechecks credentials after waiting for the durable manual queue lock", async () => {
  const h = harness(), release = h.hold();
  const pending = h.run(1, "synthetic", { apiBase: "https://owner.example", fbUserId: "12345" });
  await new Promise(resolve => setImmediate(resolve));
  h.setConfig({ token: "replacement-synthetic" }); release();
  expect(await pending).toMatchObject({ accepted: false });
  expect(h.queue).not.toHaveBeenCalled(); expect(h.flush).not.toHaveBeenCalled();
});
