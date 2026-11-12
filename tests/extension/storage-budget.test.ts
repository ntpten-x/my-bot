import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
const source = readFileSync("extension/background.js", "utf8");
function harness(initial: Record<string, unknown> = {}) {
  const stored = { outbox: [], captureJournal: [], ...initial } as Record<string, unknown>;
  const bytes = (keys: string[] | null) => Object.entries(stored).filter(([key]) => !keys || keys.includes(key))
    .reduce((sum, [key, value]) => sum + Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value)), 0);
  const set = vi.fn(async (value: object) => {
    const next = { ...stored, ...structuredClone(value) };
    if (Buffer.byteLength(JSON.stringify(next)) > 10 * 1024 * 1024) throw new Error("native quota exceeded");
    Object.assign(stored, next);
  });
  const context = vm.createContext({ Date, Set, Map, TextEncoder, crypto: globalThis.crypto,
    base: cfg => cfg.apiBase, RETRY_STATUS: new Set(), countSent: vi.fn(),
    postJson: async (_cfg, _path, body) => ({ status: 200, ok: true, json: async () => ({
      batchId: body.batchId, receipts: body.posts.map(post => ({ itemId: post.itemId, outcome: "accepted" })),
    }) }),
    rememberError: vi.fn(), chrome: { alarms: { create: vi.fn() }, storage: { local: {
      get: async defaults => ({ ...defaults, ...structuredClone(stored) }), set,
      getBytesInUse: async (keys: string[] | null) => bytes(keys),
    } } } });
  vm.runInContext(source.slice(source.indexOf("const OUTBOX_MAX ="), source.indexOf("async function countSent")), context);
  return { stored, set, bytes, queue: (item: object) => context.queueOutbox(item), drain: () => context.drainCaptureJournal(),
    flush: () => context.flushOutbox({ token: "synthetic", apiBase: "https://owner.example" }) };
}
it("reserves storage before admitting new capture data, retaining every earlier batch", async () => {
  const h = harness();
  const item = (i: number) => ({ sourceUrl: "https://example.invalid/group", apiBase: "https://owner.example",
    posts: Array.from({ length: 40 }, (_, j) => ({ url: `https://example.invalid/${i}/${j}`, text: "a".repeat(10000) })) });
  let rejected = false;
  for (let i = 0; i < 30; i++) { try { await h.queue(item(i)); } catch { rejected = true; break; } }
  expect(rejected).toBe(true);
  expect(h.bytes(null)).toBeLessThan(8 * 1024 * 1024 + 4096);
  const outbox = h.stored.outbox as { posts: unknown[] }[];
  expect(outbox.length).toBeLessThan(200); expect(outbox.every(row => row.posts.length === 40)).toBe(true);
  expect(h.stored.captureStorage).toMatchObject({ blocked: true, budgetBytes: 8 * 1024 * 1024 });
});
it("does not rewrite unchanged full queues when the journal cannot promote", async () => {
  const h = harness({ outbox: Array.from({ length: 200 }, () => ({ apiBase: "https://owner.example", posts: [] })),
    captureJournal: [{ apiBase: "https://owner.example", posts: [{ url: "https://example.invalid/1", text: "synthetic" }] }] });
  await h.drain();
  expect(h.set.mock.calls.every(([value]) => !("outbox" in value) && !("captureJournal" in value))).toBe(true);
});
it("allows a legacy oversized queue to drain without deleting journal posts", async () => {
  const h = harness({ otherState: "a".repeat(8 * 1024 * 1024), captureJournal: [] });
  await h.drain();
  expect(h.stored.captureJournal).toEqual([]);
});

it("promotes an admitted journal near the byte limit and can drain an otherwise empty outbox", async () => {
  const h = harness({ otherState: "a".repeat(8 * 1024 * 1024 - 5000) });
  const posts = Array.from({ length: 40 }, (_, i) => ({ url: `https://example.invalid/${i}`, text: "synthetic" }));
  await h.queue({ sourceUrl: "https://example.invalid/group", apiBase: "https://owner.example", posts });
  await h.drain();
  expect(h.stored.outbox).toHaveLength(1); expect(h.stored.captureJournal).toEqual([]);
  expect(h.stored.captureStorage).toMatchObject({ blocked: true });
  await h.flush();
  expect(h.stored.outbox).toEqual([]); expect(h.stored.captureStorage).toMatchObject({ blocked: false });
});

it("cleans empty legacy journal records without rewriting the unaffected outbox", async () => {
  const h = harness({ captureJournal: [{ posts: [] }, { posts: [{ invalid: true }] }] });
  await h.drain();
  expect(h.stored.captureJournal).toEqual([]);
  expect(h.set.mock.calls.every(([value]) => !("outbox" in value))).toBe(true);
});
