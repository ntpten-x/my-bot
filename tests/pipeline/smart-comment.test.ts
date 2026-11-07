import { describe, expect, it } from "vitest";
import { explainCommentRule, type MatchRule } from "../../src/lib/auto-comment/matching";
import { evaluationReasons } from "../../src/lib/auto-comment/reasons";
import { autoCommentRuleSchema } from "../../src/lib/auto-comment/schema";

const now = new Date("2026-11-07T04:00:00Z");
const rule: MatchRule = { enabled: true, pausedReason: "", sourceIdsJson: '["shoes"]', keywords: "รองเท้า,ร้องเท้า", excludeKeywords: "", keywordMode: "any", intentMode: "buyer", startMinute: 0, endMinute: 1440, daysJson: "[0,1,2,3,4,5,6]", maxAgeHours: 24 };
const post = (text: string) => ({ text, sourceId: "shoes", createdAt: now, postedAt: null, isAd: false, forbiddenHit: false, duplicateOfId: null, dismissed: false });

describe("Thai smart comment policy", () => {
  it.each(["หารองเท้าวิ่ง งบ 1000", "อยากได้รองเท้าวิ่ง", "หารองเท้า ไม่ขายครับ", "อยากได้รองเท้า แต่ไม่ซื้อของปลอม", "หารองเท้าครับ ไม่ต้องการสีแดง", "อยากได้รองเท้าแล้ว", "ช่วยแนะนำรองเท้าหน่อย", "แนะนำรองเท้าวิ่งทีครับ", "หาซื้อรองเท้า ใครขายบ้าง", "หาร้องเท้าวิ่งครับ"])("accepts buying intent: %s", text => {
    expect(explainCommentRule(rule, post(text), now).matched).toBe(true);
  });
  it.each(["ขายรองเท้ามือสอง", "ไม่หารองเท้าแล้ว", "ได้รองเท้าแล้วครับ", "รองเท้าขายแล้ว", "รองเท้าไม่ขาย", "รีวิวรองเท้าของตัวเอง", "หารายได้เสริม ขายรองเท้า"])("rejects non-buying or closed posts: %s", text => {
    expect(explainCommentRule(rule, post(text), now).matched).toBe(false);
  });
  it("requires explicit aliases, not arbitrary fuzzy matching", () => {
    expect(explainCommentRule({ ...rule, keywords: "รองเท้า" }, post("หาร้องเท้าวิ่ง"), now).matched).toBe(false);
  });
  it("uses completed classification and retains deterministic safety gates", () => {
    const classified = { ...post("รองเท้ารุ่นนี้ดีไหม"), intent: "buyer", aiProvider: "gemini:mock" };
    expect(explainCommentRule(rule, classified, now).matched).toBe(true);
    expect(explainCommentRule(rule, { ...classified, text: "ไม่หารองเท้าแล้ว" }, now).matched).toBe(false);
    expect(explainCommentRule(rule, { ...classified, forbiddenHit: true }, now).matched).toBe(false);
    expect(explainCommentRule(rule, { ...classified, isAd: true }, now).matched).toBe(false);
    expect(explainCommentRule(rule, { ...classified, aiProvider: "rules", text: "รองเท้าคู่นี้" }, now).matched).toBe(false);
  });
  it("distinguishes seller mode while preserving keyword-only legacy behavior", () => {
    expect(explainCommentRule({ ...rule, intentMode: "seller" }, post("ขายรองเท้าวิ่ง"), now).matched).toBe(true);
    expect(explainCommentRule({ ...rule, intentMode: "keyword" }, post("ไม่ขายรองเท้าแล้ว"), now).matched).toBe(true);
    expect(explainCommentRule({ ...rule, intentMode: undefined }, post("รองเท้า"), now).matched).toBe(true);
  });
  it("keeps old API defaults and validates policy/priority", () => {
    const input = { name: "legacy", sourceIds: ["shoes"], templates: ["แนะนำร้าน https://shopee.co.th/example"] };
    expect(autoCommentRuleSchema.parse(input)).toMatchObject({ intentMode: "keyword", priority: 0, enabled: false });
    expect(autoCommentRuleSchema.safeParse({ ...input, intentMode: "whatever" }).success).toBe(false);
    expect(autoCommentRuleSchema.safeParse({ ...input, priority: 101 }).success).toBe(false);
  });
});

it("renders stored reasons as owner-facing Thai and tolerates malformed metadata", () => {
  expect(evaluationReasons('[{"ruleId":"r","codes":["intent","waiting_ai"]}]', [{ id: "r", name: "รองเท้า" }])).toEqual(["รองเท้า: เจตนาไม่ตรงกฎ · รอผล AI"]);
  expect(evaluationReasons("null", [])).toEqual([]);
  expect(evaluationReasons("invalid", [])).toEqual(["อ่านรายละเอียดไม่สำเร็จ"]);
});
it("never matches truncated content even if the visible prefix matches", () => {
 expect(explainCommentRule(rule, { ...post("หารองเท้า"), truncated: true }, now).matched).toBe(false);
});
