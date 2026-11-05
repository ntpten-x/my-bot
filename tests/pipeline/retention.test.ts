import { describe, expect, it } from "vitest";
import { expiredPostsWhere, retentionPolicy } from "../../src/lib/retention";

describe("post retention", () => {
  it("keeps leads at least as long as posts and dedupe records longer", () => {
    expect(retentionPolicy({ postRetentionDays: 30, leadRetentionDays: 90 })).toEqual({ postDays: 30, leadDays: 90, tombstoneDays: 60 });
    expect(retentionPolicy({ postRetentionDays: 60, leadRetentionDays: 14 })).toEqual({ postDays: 60, leadDays: 60, tombstoneDays: 120 });
  });
  it("uses 30-day cut for ordinary posts and 90-day cut for leads", () => {
    const now = new Date("2026-11-06T00:00:00Z");
    const where = expiredPostsWhere(retentionPolicy({ postRetentionDays: 30, leadRetentionDays: 90 }), now) as { OR: { AND: { createdAt?: { lt: Date } }[] }[] };
    expect(where.OR[0].AND[0].createdAt?.lt.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(where.OR[1].AND[0].createdAt?.lt.toISOString()).toBe("2026-08-08T00:00:00.000Z");
  });
});
