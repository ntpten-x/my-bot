import { describe, expect, it } from "vitest";
import { isQueuePreservingRuleUpdate } from "../../src/lib/auto-comment/admin";
import { autoCommentRuleSchema } from "../../src/lib/auto-comment/schema";

const baseInput = () => autoCommentRuleSchema.parse({
  name: "รับเติม",
  enabled: true,
  deliveryMode: "extension",
  sourceIds: ["group-a", "group-b"],
  templates: ["สนใจ", "สนใจครับ"],
  keywords: "ขาย",
  browserDeviceId: "device-old",
  browserFbUserId: "61593431848819",
  browserConsent: true,
  areaCooldownSec: 300,
  maxAgeHours: 24,
});

describe("isQueuePreservingRuleUpdate", () => {
  it("keeps the queue when only device or cooldown changes", () => {
    const previous = {
      deliveryMode: "extension",
      messageMode: "template" as const,
      requireAi: false,
      intentMode: "keyword" as const,
      keywordMode: "any" as const,
      keywords: "ขาย",
      excludeKeywords: "",
      selectionMode: "random" as const,
      sourceIdsJson: '["group-a","group-b"]',
      templates: [{ body: "สนใจ" }, { body: "สนใจครับ" }],
    };
    const next = { ...baseInput(), selectionMode: "random" as const, browserDeviceId: "device-new", areaCooldownSec: 60, name: "รับเติม (desktop)" };
    expect(isQueuePreservingRuleUpdate(previous, next, [{ body: "สนใจ" }, { body: "สนใจครับ" }], ["group-a", "group-b"])).toBe(true);
  });

  it("cancels the queue when keywords or templates change", () => {
    const previous = {
      deliveryMode: "extension",
      messageMode: "template" as const,
      requireAi: false,
      intentMode: "keyword" as const,
      keywordMode: "any" as const,
      keywords: "ขาย",
      excludeKeywords: "",
      selectionMode: "random" as const,
      sourceIdsJson: '["group-a"]',
      templates: [{ body: "สนใจ" }],
    };
    expect(isQueuePreservingRuleUpdate(previous, { ...baseInput(), keywords: "ซื้อ" }, [{ body: "สนใจ" }], ["group-a"])).toBe(false);
    expect(isQueuePreservingRuleUpdate(previous, baseInput(), [{ body: "ข้อความใหม่" }], ["group-a"])).toBe(false);
    expect(isQueuePreservingRuleUpdate(previous, baseInput(), [{ body: "สนใจ", imagePath: "templates/a/x.jpg" }], ["group-a"])).toBe(false);
  });
});
