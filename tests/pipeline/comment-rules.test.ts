import { describe, expect, it } from "vitest";
import { matchRule, queueRuleFor } from "../../src/lib/automation";
import { ruleData } from "../../src/lib/automation-schema";

const base = { enabled: true, categoryId: null, keywords: "", provinces: "", intent: "", minScore: 0 };
const post = {
  text: "หาซื้อไอดี roblox", ocrText: "", categoryId: "game", subcategoryId: "id", province: null, intent: "buyer", score: 70,
  isAd: false, forbiddenHit: false, duplicateOfId: null, productId: "roblox", sourceId: "g1", createdAt: new Date(1_000_000_000),
};
const now = 1_000_000_000 + 2 * 3_600_000;

describe("comment rules (กฎการเม้น)", () => {
  it("checks sub-category, product, groups, exclude words and post age", () => {
    expect(matchRule({ ...base, subcategoryId: "id", productId: "roblox", sourceIds: "g1,g2" }, post, now)).toBe(true);
    expect(matchRule({ ...base, subcategoryId: "other" }, post, now)).toBe(false);
    expect(matchRule({ ...base, productId: "rov" }, post, now)).toBe(false);
    expect(matchRule({ ...base, sourceIds: "g9" }, post, now)).toBe(false);
    expect(matchRule({ ...base, excludeKeywords: "ขาย, ROBLOX" }, post, now)).toBe(false);
    expect(matchRule({ ...base, maxAgeHours: 1 }, post, now)).toBe(false);
    expect(matchRule({ ...base, maxAgeHours: 3 }, post, now)).toBe(true);
    expect(matchRule({ ...base, maxAgeHours: 1 }, { ...post, postedAt: new Date(now - 600_000) }, now)).toBe(true);
    expect(matchRule({ ...base, intent: "buyer", minScore: 80 }, post, now)).toBe(false);
  });

  it("picks the first queue rule by priority and ignores non-queue rules", () => {
    const rules = [
      { ...base, id: "late", actionQueue: true, priority: 5 },
      { ...base, id: "notQueue", actionQueue: false, priority: 0 },
      { ...base, id: "first", actionQueue: true, priority: 1, productId: "roblox" },
      { ...base, id: "miss", actionQueue: true, priority: 0, productId: "rov" },
    ];
    expect(queueRuleFor(rules, post, now)?.id).toBe("first");
    expect(queueRuleFor(rules.filter((rule) => rule.id !== "first"), post, now)?.id).toBe("late");
    expect(queueRuleFor([{ ...base, id: "x", actionQueue: true, enabled: false }], post, now)).toBeNull();
  });

  it("maps API arrays to stored lists", () => {
    expect(ruleData({ name: "r", sourceIds: ["a", "b"], templateIds: [], productId: "", categoryId: null })).toMatchObject({
      sourceIds: "a,b", templateIds: "", productId: null, categoryId: null,
    });
  });
});
