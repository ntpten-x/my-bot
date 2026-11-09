import { expect, it } from "vitest";
import { explainCommentRule, isKeywordBotRule } from "@/lib/auto-comment/matching";

const base = {
  enabled: true,
  pausedReason: "",
  sourceIdsJson: JSON.stringify(["src"]),
  keywords: "หาช่าง",
  excludeKeywords: "",
  keywordMode: "any",
  startMinute: 0,
  endMinute: 1440,
  daysJson: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
  maxAgeHours: 24,
  intentMode: "keyword",
  requireAi: false,
  messageMode: "template",
  deliveryMode: "extension",
};

it("treats extension template keyword rules as immediate bots", () => {
  expect(isKeywordBotRule(base)).toBe(true);
  expect(isKeywordBotRule({ ...base, requireAi: true })).toBe(false);
  expect(isKeywordBotRule({ ...base, intentMode: "buyer" })).toBe(false);
  expect(isKeywordBotRule({ ...base, messageMode: "ai_draft" })).toBe(false);
});

it("lets keyword bots match truncated posts once required words are already present", () => {
  const post = {
    truncated: true,
    text: "หาช่างแอร์ด่วน…",
    sourceId: "src",
    createdAt: new Date(),
    postedAt: new Date(),
    isAd: false,
    forbiddenHit: false,
    duplicateOfId: null,
    dismissed: false,
  };
  expect(explainCommentRule(base, post).matched).toBe(true);
  expect(explainCommentRule({ ...base, requireAi: true }, post).matched).toBe(false);
  expect(explainCommentRule({ ...base, keywords: "" }, post).matched).toBe(false);
});
