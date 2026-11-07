import { describe, expect, it } from "vitest";
import { buildKnownHints, pickRefetchFromPool } from "@/lib/scrape-hints";

describe("buildKnownHints", () => {
  const since = new Date("2026-11-07T00:00:00Z");
  const now = new Date("2026-11-07T12:00:00Z");

  it("keeps up to 300 keys per source and newest postedAt", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => ({
        sourceId: "a",
        externalUrl: `https://www.facebook.com/groups/1/posts/${1000 + i}/`,
        postedAt: new Date(since.getTime() + i * 60_000),
        createdAt: since,
        text: "ok",
      })),
      {
        sourceId: "b",
        externalUrl: "https://www.facebook.com/marketplace/item/55/",
        postedAt: null,
        createdAt: now,
        text: "ขาย… ดูเพิ่มเติม",
      },
    ];
    const hints = buildKnownHints(["a", "b", "c"], rows, now);
    expect(hints.get("a")?.keys).toEqual(["p:1000", "p:1001", "p:1002", "p:1003", "p:1004"]);
    expect(hints.get("a")?.lastSeenAt).toBe(new Date(since.getTime() + 4 * 60_000).toISOString());
    expect(hints.get("b")?.keys).toEqual(["mp:55"]);
    expect(hints.get("c")).toEqual({ keys: [], lastSeenAt: null, legacyTruncated: [] });
  });

  it("caps each source at 300 rows even when the batch is larger", () => {
    const rows = Array.from({ length: 350 }, (_, i) => ({
      sourceId: "a",
      externalUrl: `https://www.facebook.com/groups/1/posts/${i}/`,
      postedAt: new Date(since.getTime() + i * 1000),
      createdAt: since,
      text: "x",
    }));
    const hints = buildKnownHints(["a"], rows, now);
    expect(hints.get("a")?.keys).toHaveLength(300);
  });
});

describe("pickRefetchFromPool", () => {
  it("ranks per source and returns up to the limit", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    const pool = [
      { id: "1", sourceId: "a", externalUrl: "https://www.facebook.com/groups/1/posts/1/", score: 90, createdAt: now, refetchAttempts: 0 },
      { id: "2", sourceId: "a", externalUrl: "https://www.facebook.com/groups/1/posts/2/", score: 10, createdAt: now, refetchAttempts: 0 },
      { id: "3", sourceId: "b", externalUrl: "https://www.facebook.com/groups/1/posts/3/", score: 50, createdAt: now, refetchAttempts: 1 },
    ];
    const picked = pickRefetchFromPool(["a", "b"], pool, now, 1);
    expect(picked.get("a")).toEqual(["https://www.facebook.com/groups/1/posts/1/"]);
    expect(picked.get("b")).toEqual(["https://www.facebook.com/groups/1/posts/3/"]);
  });
});
