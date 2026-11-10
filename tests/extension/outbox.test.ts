import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function harness(status: number) {
  const stored: Record<string, unknown> = { outbox: [{ sourceUrl: "https://www.facebook.com/groups/123", posts: [{ text: "synthetic" }], at: Date.now(), apiBase: "https://owner.example" }] };
  const source = readFileSync("extension/background.js", "utf8");
  const postJson = vi.fn(async (_cfg: unknown, _url: string, body: { batchId?: string; posts: { itemId?: string }[] }) => ({ status, ok: status >= 200 && status < 300,
    json: async () => ({ batchId: body.batchId, receipts: body.posts.map(post => ({ itemId: post.itemId, outcome: "accepted" })) }),
  }));
  const context = vm.createContext({ Date, Set, Map, crypto: globalThis.crypto, postJson, RETRY_STATUS: new Set([408, 429, 502, 503, 504]),
    countSent: vi.fn(), rememberError: vi.fn(), base: (cfg: { apiBase: string }) => cfg.apiBase,
    chrome: { storage: { local: {
      get: async (defaults: object) => ({ ...defaults, ...structuredClone(stored) }),
      set: async (value: object) => Object.assign(stored, structuredClone(value)),
    } } },
  });
  vm.runInContext(source.slice(source.indexOf("const OUTBOX_MAX ="), source.indexOf("async function countSent")), context);
  vm.runInContext(source.slice(source.indexOf("async function dropProblemOutbox()"), source.indexOf("async function cycle()")), context);
  return { stored, postJson,
    queue: (item: object) => vm.runInContext("queueOutbox", context)(item) as Promise<unknown>,
    reload: () => vm.runInContext("dropProblemOutbox()", context) as Promise<void>,
    flush: () => vm.runInContext('flushOutbox({ token: "synthetic", apiBase: "https://owner.example" })', context) as Promise<void>,
  };
}
it.each([401, 403, 423, 429, 503])("retains unsent posts for HTTP %i", async status => {
  const h = harness(status); await h.flush(); expect(h.stored.outbox).toHaveLength(1);
});
it("removes acknowledged posts", async () => { const h = harness(200); await h.flush(); expect(h.stored.outbox).toEqual([]); });

it("does not mark a paused account's queued batch as permanently rejected", async () => {
  const h = harness(423); await h.flush();
  expect((h.stored.outbox as { problem?: string }[])[0].problem).toBeUndefined();
});

it("drains the current server behind another server's queued posts without sending those posts", async () => {
  const h = harness(200);
  const current = (h.stored.outbox as object[])[0];
  const foreign = { sourceUrl: "https://www.facebook.com/groups/456", posts: [{ text: "other server" }], at: Date.now(), apiBase: "https://other.example" };
  h.stored.outbox = [foreign, current];
  await h.flush();
  expect(h.postJson).toHaveBeenCalledTimes(1);
  expect(h.stored.outbox).toEqual([foreign]);
});

it("releases global backpressure after draining this server from a full mixed queue", async () => {
  const h = harness(200);
  const current = (h.stored.outbox as object[])[0];
  const foreign = { sourceUrl: "https://www.facebook.com/groups/456", posts: [{ text: "other server" }], at: Date.now(), apiBase: "https://other.example" };
  h.stored.outbox = [...Array.from({ length: 199 }, () => ({ ...foreign })), current];
  h.stored.outboxBlocked = true;
  await h.flush();
  expect(h.postJson).toHaveBeenCalledTimes(1);
  expect(h.stored.outbox).toHaveLength(199);
  expect(h.stored.outboxBlocked).toBe(false);
});

it("does not block the current origin when only another server filled its per-origin cap", async () => {
  const h = harness(200);
  h.stored.outbox = Array.from({ length: 200 }, () => ({ apiBase: "https://other.example", posts: [], at: Date.now() }));
  await h.flush();
  expect(h.postJson).not.toHaveBeenCalled();
  expect(h.stored.outbox).toHaveLength(200);
  // Foreign origin at 200 must not freeze capture for the current apiBase.
  expect(h.stored.outboxBlocked).toBe(false);
});

it("keeps the global storage limit active when total outbox capacity is exhausted", async () => {
  const h = harness(200);
  h.stored.outbox = Array.from({ length: 400 }, () => ({ apiBase: "https://other.example", posts: [], at: Date.now() }));
  await h.flush();
  expect(h.postJson).not.toHaveBeenCalled();
  expect(h.stored.outbox).toHaveLength(400);
  expect(h.stored.outboxBlocked).toBe(true);
});

it("never removes a foreign legacy batch with the same source and timestamp", async () => {
  const h = harness(200);
  const current = (h.stored.outbox as { sourceUrl: string; at: number }[])[0];
  const foreign = { ...current, apiBase: "https://other.example" };
  h.stored.outbox = [foreign, current];
  await h.flush();
  expect(h.stored.outbox).toEqual([foreign]);
});

it("requires item receipts before removing a current server's durable batch", async () => {
  const h = harness(200);
  const foreign = { apiBase: "https://other.example", at: Date.now(), posts: [{ text: "foreign" }] };
  h.stored.outbox = [foreign, { apiBase: "https://owner.example", sourceUrl: "https://www.facebook.com/groups/123", at: Date.now(), batchId: "synthetic-batch", posts: [{ text: "current", itemId: "synthetic-item" }] }];
  await h.flush();
  expect(h.postJson).toHaveBeenCalledTimes(1);
  expect(h.postJson.mock.calls[0][2]).toMatchObject({ batchId: "synthetic-batch", posts: [{ itemId: "synthetic-item" }] });
  expect(h.stored.outbox).toEqual([foreign]);
});

it("retains rejected and expired batches for owner review across worker reload", async () => {
  const h = harness(200);
  const rejected = { batchId: "rejected", apiBase: "https://owner.example", problem: "http_400", posts: [{ text: "rejected original" }], at: Date.now() };
  const expired = { batchId: "expired", apiBase: "https://other.example", problem: "expired", posts: [{ text: "expired original" }], at: Date.now() - 73 * 3600000 };
  h.stored.outbox = [rejected, expired];
  await h.reload();
  await h.flush();
  expect(h.stored.outbox).toEqual([rejected, expired]);
  expect(h.postJson).not.toHaveBeenCalled();
});

it("keeps review batches counted against global storage backpressure after reload", async () => {
  const h = harness(200);
  h.stored.outbox = Array.from({ length: 400 }, () => ({ problem: "expired", posts: [{ text: "retained" }] }));
  await h.reload();
  expect(h.stored.outbox).toHaveLength(400);
  expect(h.stored.outboxBlocked).toBe(true);
});

it("sends valid peers while retaining a full oversized post without automatic retry", async () => {
  const h = harness(200);
  h.stored.outbox = [];
  const oversized = { url: "https://www.facebook.com/groups/123/posts/1", text: "x".repeat(20001) + " forbidden at end" };
  const valid = Array.from({ length: 39 }, (_, index) => ({ url: `https://www.facebook.com/groups/123/posts/${index + 2}`, text: "valid synthetic post" }));
  await h.queue({ sourceUrl: "https://www.facebook.com/groups/123", posts: [oversized, ...valid], fbUserId: "123456", apiBase: "https://owner.example" });
  await h.flush();
  expect(h.postJson).toHaveBeenCalledTimes(1);
  expect(h.postJson.mock.calls[0][2].posts).toHaveLength(39);
  const retained = h.stored.outbox as { problem?: string; fbUserId: string; apiBase: string; posts: { text: string; url: string }[] }[];
  expect(retained).toHaveLength(1);
  expect(retained[0].problem).toBeTruthy();
  expect(retained[0]).toMatchObject({ apiBase: "https://owner.example", fbUserId: "123456", posts: [oversized] });
  await h.reload();
  await h.flush();
  expect(h.postJson).toHaveBeenCalledTimes(1);
  expect(h.stored.outbox).toEqual(retained);
});

it("delivers text at the API size boundary without cutting its final exclusion words", async () => {
  const h = harness(200);
  h.stored.outbox = [];
  const text = "x".repeat(19990) + " forbidden";
  await h.queue({ sourceUrl: "https://www.facebook.com/groups/123", posts: [{ url: "https://www.facebook.com/groups/123/posts/1", text }], apiBase: "https://owner.example" });
  await h.flush();
  expect(h.postJson.mock.calls[0][2].posts[0]).toMatchObject({ text });
  expect(h.stored.outbox).toEqual([]);
});

it("does not acknowledge a mixed batch when its complete durable journal admission exceeds capacity", async () => {
  const h = harness(200);
  h.stored.outbox = Array.from({ length: 400 }, () => ({ apiBase: "https://other.example", posts: [], at: Date.now() }));
  const previous = Array.from({ length: 399 }, (_, index) => ({
    sourceUrl: `https://www.facebook.com/groups/${index + 1000}`, apiBase: "https://other.example", fbUserId: "999999",
    posts: [{ url: `https://www.facebook.com/groups/${index + 1000}/posts/1`, text: "already durable" }],
  }));
  h.stored.captureJournal = previous;
  await expect(h.queue({ sourceUrl: "https://www.facebook.com/groups/123", apiBase: "https://owner.example", fbUserId: "123456", posts: [
    { url: "https://www.facebook.com/groups/123/posts/1", text: "x".repeat(20001) },
    { url: "https://www.facebook.com/groups/123/posts/2", text: "valid peer" },
  ] })).rejects.toThrow("capture journal full");
  expect(h.stored.captureJournal).toEqual(previous);
  expect(h.stored.outbox).toHaveLength(400);
  expect(h.stored.journalRejectedItems).toBe(2);
});
