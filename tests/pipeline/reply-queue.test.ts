import { describe, expect, it } from "vitest";
import { authorKeyOf, dueSlot, gapRemainingMs, parseTimes, pickTemplate, randomGapMs, selectQueue } from "../../src/lib/reply-queue-core";
import { replyQueueSettingsSchema } from "../../src/lib/reply-queue-schema";

describe("reply queue schedule", () => {
  it("parses, dedupes, sorts and caps times", () => {
    expect(parseTimes("18:00, 9:00 09:00;25:00 x 7:5")).toEqual(["09:00", "18:00"]);
    expect(parseTimes("1:00,2:00,3:00,4:00,5:00,6:00,7:00")).toHaveLength(6);
    expect(parseTimes(null)).toEqual([]);
  });

  it("returns the latest passed slot once", () => {
    const times = ["09:00", "18:00"];
    expect(dueSlot({ day: "2026-11-02", time: "08:59" }, times, null)).toBeNull();
    expect(dueSlot({ day: "2026-11-02", time: "09:00" }, times, null)).toBe("2026-11-02 09:00");
    expect(dueSlot({ day: "2026-11-02", time: "12:00" }, times, "2026-11-02 09:00")).toBeNull();
    expect(dueSlot({ day: "2026-11-02", time: "18:30" }, times, "2026-11-02 09:00")).toBe("2026-11-02 18:00");
    expect(dueSlot({ day: "2026-11-03", time: "09:01" }, times, "2026-11-02 18:00")).toBe("2026-11-03 09:00");
  });
});

describe("reply gap", () => {
  it("jitters inside the configured range", () => {
    expect(randomGapMs(2, 5, () => 0)).toBe(120_000);
    expect(randomGapMs(2, 5, () => 1)).toBe(300_000);
    expect(randomGapMs(5, 2, () => 0.5)).toBe(randomGapMs(2, 5, () => 0.5));
    for (let i = 0; i < 50; i++) {
      const gap = randomGapMs(2, 5);
      expect(gap).toBeGreaterThanOrEqual(120_000);
      expect(gap).toBeLessThanOrEqual(300_000);
    }
  });

  it("reports time left before the next open", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    expect(gapRemainingMs(null, now)).toBe(0);
    expect(gapRemainingMs("2026-11-02T10:03:00Z", now)).toBe(180_000);
    expect(gapRemainingMs("2026-11-02T09:59:00Z", now)).toBe(0);
    expect(gapRemainingMs("garbage", now)).toBe(0);
  });
});

describe("reply queue dedupe", () => {
  const base = { remaining: 10, groupCap: 2, groupCounts: new Map<string, number>(), recentAuthors: new Set<string>(), queuedPostIds: new Set<string>() };

  it("normalises author names", () => {
    expect(authorKeyOf("  สมชาย   ใจดี ")).toBe(authorKeyOf("สมชาย ใจดี"));
    expect(authorKeyOf("John DOE")).toBe("john doe");
  });

  it("never queues the same post twice", () => {
    const out = selectQueue([{ id: "p1", authorKey: "a", sourceId: "g" }, { id: "p2", authorKey: "b", sourceId: "g" }], { ...base, queuedPostIds: new Set(["p1"]) });
    expect(out.map((item) => item.id)).toEqual(["p2"]);
  });

  it("skips authors replied to within the window and repeats in one batch", () => {
    const out = selectQueue(
      [
        { id: "p1", authorKey: "old", sourceId: "g1" },
        { id: "p2", authorKey: "new", sourceId: "g1" },
        { id: "p3", authorKey: "new", sourceId: "g2" },
        { id: "p4", authorKey: "", sourceId: "g2" },
        { id: "p5", authorKey: "", sourceId: "g3" },
      ],
      { ...base, recentAuthors: new Set(["old"]) },
    );
    expect(out.map((item) => item.id)).toEqual(["p2", "p4", "p5"]);
  });

  it("enforces the per-group daily cap including items already queued today", () => {
    const candidates = ["a", "b", "c", "d"].map((author, index) => ({ id: `p${index}`, authorKey: author, sourceId: "g1" }));
    expect(selectQueue(candidates, base)).toHaveLength(2);
    expect(selectQueue(candidates, { ...base, groupCounts: new Map([["g1", 1]]) })).toHaveLength(1);
    expect(selectQueue(candidates, { ...base, groupCounts: new Map([["g1", 2]]) })).toHaveLength(0);
  });

  it("stops at the remaining daily cap", () => {
    const candidates = Array.from({ length: 30 }, (_, index) => ({ id: `p${index}`, authorKey: `a${index}`, sourceId: `g${index}` }));
    expect(selectQueue(candidates, { ...base, remaining: 20 })).toHaveLength(20);
    expect(selectQueue(candidates, { ...base, remaining: 0 })).toHaveLength(0);
  });
});

describe("template rotation", () => {
  const templates = [
    { id: "t1", categoryId: null, useCount: 0, sortOrder: 0 },
    { id: "t2", categoryId: null, useCount: 0, sortOrder: 1 },
    { id: "t3", categoryId: "cat-a", useCount: 4, sortOrder: 0 },
    { id: "t4", categoryId: "cat-a", useCount: 4, sortOrder: 1 },
  ];

  it("rotates generic templates by least use", () => {
    const usage = new Map<string, number>();
    const picks = [1, 2, 3, 4].map(() => pickTemplate(templates, ["other"], usage)?.id);
    expect(picks).toEqual(["t1", "t2", "t1", "t2"]);
  });

  it("prefers templates for the lead's category and rotates among them", () => {
    const usage = new Map<string, number>();
    const picks = [1, 2, 3].map(() => pickTemplate(templates, ["cat-a", null], usage)?.id);
    expect(picks).toEqual(["t3", "t4", "t3"]);
  });

  it("returns null with no usable template", () => {
    expect(pickTemplate([{ id: "x", categoryId: "c", useCount: 0, sortOrder: 0 }], ["d"], new Map())).toBeNull();
  });
});

describe("reply queue settings", () => {
  it("validates bounds", () => {
    const ok = { enabled: true, times: "09:00,18:00", dailyCap: 20, gapMinMinutes: 2, gapMaxMinutes: 5, authorDays: 7, groupDailyCap: 5, minScore: 60 };
    expect(replyQueueSettingsSchema.safeParse(ok).success).toBe(true);
    expect(replyQueueSettingsSchema.safeParse({ ...ok, dailyCap: 0 }).success).toBe(false);
    expect(replyQueueSettingsSchema.safeParse({ ...ok, dailyCap: 500 }).success).toBe(false);
    expect(replyQueueSettingsSchema.safeParse({ ...ok, gapMinMinutes: -1 }).success).toBe(false);
  });
});
