import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

const post = "https://www.facebook.com/groups/12345/posts/8888/";
function harness() {
  const session: Record<string, unknown> = {};
  const tabs = { get: vi.fn(async () => ({ id: 1, windowId: 2, url: post })),
    query: vi.fn(async () => [{ id: 1 }]), remove: vi.fn(async () => {}), update: vi.fn(async () => {}) };
  const context = vm.createContext({ Date, URL, setTimeout, clearTimeout, chrome: { tabs, storage: { session: {
    get: async defaults => ({ ...defaults, ...session }), set: async value => Object.assign(session, value),
  } } } });
  vm.runInContext(readFileSync("extension/tab-lifecycle.js", "utf8"), context);
  const api = context.MyBotTabs;
  return { api, tabs, session, ref: { tabId: 1, windowId: 2, url: post, ephemeral: true } };
}

it("closes a known owned post, without querying unrelated tabs", async () => {
  const h = harness();
  expect(await h.api.close(h.ref, h.api.samePostUrl)).toBe("closed");
  expect(h.tabs.remove).toHaveBeenCalledWith(1);
  expect(h.tabs.query).not.toHaveBeenCalled();
});
it("keeps ownership after a lookup error even when query still sees the ID", async () => {
  const h = harness(); h.tabs.get.mockRejectedValue(new Error("temporary"));
  expect(await h.api.close(h.ref, h.api.samePostUrl)).toBe("retry");
  expect(h.tabs.remove).not.toHaveBeenCalled();
});
it("forgets only confirmed absent tabs after lookup failure", async () => {
  const h = harness(); h.tabs.get.mockRejectedValue(new Error("missing")); h.tabs.query.mockResolvedValue([]);
  expect(await h.api.close(h.ref, h.api.samePostUrl)).toBe("gone");
});
it("retains ownership when both lookup methods fail", async () => {
  const h = harness(); h.tabs.get.mockRejectedValue(new Error("temporary")); h.tabs.query.mockRejectedValue(new Error("temporary"));
  expect(await h.api.close(h.ref, h.api.samePostUrl)).toBe("retry");
});
it("retains ownership after Chrome refuses the close", async () => {
  const h = harness(); h.tabs.remove.mockRejectedValue(new Error("temporary"));
  expect(await h.api.close(h.ref, h.api.samePostUrl)).toBe("retry");
});
it.each(["https://example.com/personal", "https://www.facebook.com/groups/12345/posts/9999/", "https://www.facebook.com/checkpoint/"])("releases rather than closing owner/unknown navigation: %s", async url => {
  const h = harness(); h.tabs.get.mockResolvedValue({ id: 1, windowId: 2, url });
  expect(await h.api.close(h.ref, h.api.samePostUrl)).toBe("released");
  expect(h.tabs.remove).not.toHaveBeenCalled();
});
it("releases a reader moved into the owner's window", async () => {
  const h = harness(); h.tabs.get.mockResolvedValue({ id: 1, windowId: 99, url: post });
  expect(await h.api.close(h.ref, h.api.samePostUrl)).toBe("released");
  expect(h.tabs.remove).not.toHaveBeenCalled();
});
it("accepts only canonical aliases of the same Facebook post", async () => {
  const h = harness(); h.tabs.get.mockResolvedValue({ id: 1, windowId: 2, url: "https://web.facebook.com/groups/12345/permalink/8888/?comment_id=77" });
  expect(await h.api.close(h.ref, h.api.samePostUrl)).toBe("closed");
  expect(h.api.samePostUrl("https://evil.test/groups/12345/posts/8888/", post)).toBe(false);
});
it("backs off 30/60/120 seconds then 5 minutes without dropping the record", () => {
  const h = harness(); let ref = h.ref;
  const before = Date.now();
  for (const delay of [30000, 60000, 120000, 300000, 300000]) {
    ref = h.api.retry(ref);
    expect(ref.closeAfter - before).toBeGreaterThanOrEqual(delay);
    expect(ref.closeAfter - Date.now()).toBeLessThanOrEqual(delay);
    expect(h.api.due(ref)).toBe(false);
    expect(ref.tabId).toBe(1);
  }
});
it("counts only session-owned tabs and distinguishes active, parked and closing", () => {
  const h = harness();
  expect(h.api.summary({ a: { tabId: 1 }, b: { tabId: 2, continuation: {} }, c: { tabId: 3, closing: true }, d: { tabId: 4 } },
    new Set([1]), { tabId: 5 }, false, { released: 2 }, { closing: true })).toMatchObject({ activeReaders: 1,
    activeComments: 0, parkedReaders: 1, closing: 3, idleReaders: 1, released: 2 });
});
it("bounds an unresponsive Chrome lookup and keeps ownership retryable", async () => {
  vi.useFakeTimers();
  try {
    const h = harness(); h.tabs.get.mockImplementation(() => new Promise(() => {})); h.tabs.query.mockImplementation(() => new Promise(() => {}));
    const pending = h.api.lookup(1);
    await vi.advanceTimersByTimeAsync(10001);
    expect(await pending).toEqual({ state: "retry" });
  } finally { vi.useRealTimers(); }
});

it("does not start Chrome work after the shared cleanup deadline", async () => {
  const h = harness();
  expect(await h.api.close(h.ref, h.api.samePostUrl, { deadlineMs: Date.now() - 1 })).toBe("retry");
  expect(h.tabs.get).not.toHaveBeenCalled();expect(h.tabs.query).not.toHaveBeenCalled();expect(h.tabs.remove).not.toHaveBeenCalled();
});

it("releases far-future or excess parked readers while preserving active and unrecovered work", () => {
  const h = harness(), now = Date.now();
  const readers = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [String(index + 1), {
    tabId: index + 1, at: now, continuation: { sourceId: `source-${index + 1}` },
  }]));
  const schedules = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`source-${index + 1}`, now + (index + 1) * 10000]));
  const result = h.api.parkedReleaseIds(readers, new Set([1]), {
    now, schedules, recoverable: new Set([2, 3, 4, 5, 6, 7]),
  });
  // Active 1 is outside the parked budget; unrecovered 8 consumes one of four slots.
  expect([...result]).toEqual([5, 6, 7]);
  expect(result.has(1)).toBe(false); expect(result.has(8)).toBe(false);
});

it("releases distant and unknown schedules only after durable recovery is confirmed", () => {
  const h = harness(), now = Date.now();
  const readers = {
    a: { tabId: 1, at: now, continuation: { sourceId: "distant" } },
    b: { tabId: 2, at: now, continuation: { sourceId: "missing" } },
    c: { tabId: 3, at: now, continuation: { sourceId: "distant" } },
    d: { tabId: 4, at: now, closing: true, continuation: { sourceId: "distant" } },
  };
  expect([...h.api.parkedReleaseIds(readers, new Set(), {
    now, schedules: { distant: now + 90001 }, recoverable: new Set([1, 2, 4]),
  })]).toEqual([1, 2]);
});
