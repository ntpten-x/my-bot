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

it("waits for full text before matching keyword bots", () => {
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
  const truncated = explainCommentRule(base, post);
  expect(truncated.matched).toBe(false);
  expect(truncated.checks.find((check) => check.code === "full_text")?.passed).toBe(false);
  expect(explainCommentRule(base, { ...post, truncated: false }).matched).toBe(true);
});

it("rejects empty keyword lists for keyword bots", () => {
  const post = {
    truncated: false,
    text: "หาช่างแอร์ด่วน",
    sourceId: "src",
    createdAt: new Date(),
    postedAt: new Date(),
    isAd: false,
    forbiddenHit: false,
    duplicateOfId: null,
    dismissed: false,
  };
  const empty = explainCommentRule({ ...base, keywords: "" }, post);
  expect(empty.matched).toBe(false);
  expect(empty.checks.find((check) => check.code === "keywords")?.passed).toBe(false);
});

it("does not match when exclusions appear only after full text expands", () => {
  const card = {
    truncated: false,
    text: "หาช่างแอร์ด่วน ได้แล้วครับ ไม่ต้องแล้ว",
    sourceId: "src",
    createdAt: new Date(),
    postedAt: new Date(),
    isAd: false,
    forbiddenHit: false,
    duplicateOfId: null,
    dismissed: false,
  };
  expect(explainCommentRule({ ...base, excludeKeywords: "ได้แล้ว" }, card).matched).toBe(false);
});
