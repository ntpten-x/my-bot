import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";

function harness() {
  const stored: Record<string, unknown> = { outbox: [], captureJournal: [], captureJournalPending: 0, outboxBlocked: false };
  const source = readFileSync("extension/background.js", "utf8");
  const context = vm.createContext({
    Date, Set, Map, crypto: globalThis.crypto,
    rememberError: async () => undefined,
    chrome: {
      storage: {
        local: {
          get: async (defaults: object) => ({ ...defaults, ...structuredClone(stored) }),
          set: async (value: object) => Object.assign(stored, structuredClone(value)),
        },
      },
      alarms: { create: async () => undefined },
    },
  });
  vm.runInContext(source.slice(source.indexOf("const OUTBOX_MAX ="), source.indexOf("async function countSent")), context);
  return {
    stored,
    queue: (item: object) => vm.runInContext("queueOutbox", context)(item) as Promise<object>,
    drain: () => vm.runInContext("drainCaptureJournal()", context) as Promise<object>,
  };
}

function posts(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://www.facebook.com/groups/123/posts/${start + index}`,
    text: `synthetic ${start + index}`,
  }));
}

it("keeps every unique post across batches when the outbox is already full", async () => {
  const h = harness();
  h.stored.outbox = Array.from({ length: 200 }, () => ({
    apiBase: "https://other.example",
    posts: [{ url: "https://www.facebook.com/groups/x/posts/1", text: "foreign" }],
    at: Date.now(),
  }));
  await h.queue({
    sourceUrl: "https://www.facebook.com/groups/123",
    posts: posts(1, 40),
    fbUserId: "111",
    apiBase: "https://owner.example",
  });
  await h.queue({
    sourceUrl: "https://www.facebook.com/groups/123",
    posts: posts(41, 40),
    fbUserId: "111",
    apiBase: "https://owner.example",
  });
  const journal = (h.stored.captureJournal || []) as { posts: { url: string }[] }[];
  const urls = journal.flatMap((entry) => entry.posts.map((post) => post.url));
  // Foreign origin at per-origin cap no longer blocks the current origin, so some may already promote.
  expect(urls.length + ((h.stored.outbox as { apiBase?: string; posts: unknown[] }[]) || [])
    .filter((row) => row.apiBase === "https://owner.example")
    .reduce((sum, row) => sum + row.posts.length, 0)).toBe(80);
  expect(new Set([
    ...urls,
    ...((h.stored.outbox as { apiBase?: string; posts: { url: string }[] }[]) || [])
      .filter((row) => row.apiBase === "https://owner.example")
      .flatMap((row) => row.posts.map((post) => post.url)),
  ]).size).toBe(80);
});

it("promotes leftover journal posts after an origin gains outbox room", async () => {
  const h = harness();
  h.stored.outbox = Array.from({ length: 200 }, () => ({
    apiBase: "https://owner.example",
    posts: [{ url: "https://www.facebook.com/groups/x/posts/1", text: "fill" }],
    at: Date.now(),
  }));
  await h.queue({
    sourceUrl: "https://www.facebook.com/groups/123",
    posts: posts(1, 40),
    fbUserId: "111",
    apiBase: "https://owner.example",
  });
  await h.queue({
    sourceUrl: "https://www.facebook.com/groups/123",
    posts: posts(41, 40),
    fbUserId: "111",
    apiBase: "https://owner.example",
  });
  const pendingBefore = Number(h.stored.captureJournalPending || 0);
  expect(pendingBefore).toBe(80);
  h.stored.outbox = [];
  await h.drain();
  const journalLeft = ((h.stored.captureJournal || []) as { posts: unknown[] }[]).reduce((sum, row) => sum + row.posts.length, 0);
  const outboxPosts = ((h.stored.outbox || []) as { posts: unknown[] }[]).reduce((sum, row) => sum + row.posts.length, 0);
  expect(outboxPosts + journalLeft).toBe(80);
  expect(outboxPosts).toBe(80);
  expect(journalLeft).toBe(0);
});
