import { describe, expect, it } from "vitest";
import { HOT_SCORE, scoreLead } from "../../src/lib/smart/score";
import { cosine, nearestDuplicate } from "../../src/lib/smart/vector";
import { mineSuggestions } from "../../src/lib/smart/keywords";
import { buildSummary, shouldSendSummary } from "../../src/lib/smart/summary";
import { preferenceScore } from "../../src/lib/smart/preference";

describe("lead score", () => {
  it("marks a specific urgent buyer with budget and watch words as hot", () => {
    const result = scoreLead({
      text: "หาคนรับเติมเพชร ROV ด่วน งบ 500 บาท วันนี้",
      intent: "buyer",
      isAd: false,
      forbidden: false,
      keywordHits: 2,
      ageHours: 1,
      sourceQuality: 0.9,
      preference: 0.2,
    });
    expect(result.score).toBeGreaterThanOrEqual(HOT_SCORE);
    expect(result.reason).toContain("คนกำลังหา");
  });

  it("keeps ads and forbidden posts near the bottom", () => {
    expect(scoreLead({ text: "โปร", intent: "seller", isAd: true, forbidden: false, keywordHits: 0, ageHours: 1, sourceQuality: 1 }).score).toBeLessThan(20);
    expect(scoreLead({ text: "พนัน", intent: "buyer", isAd: false, forbidden: true, keywordHits: 1, ageHours: 1, sourceQuality: 1 }).score).toBeLessThan(20);
  });
});

describe("embeddings", () => {
  it("treats the same vector as a near duplicate", () => {
    const vector = [0.2, 0.4, 0.8];
    expect(cosine(vector, vector)).toBeCloseTo(1);
    expect(nearestDuplicate(vector, [{ id: "old", vector }])?.id).toBe("old");
    expect(nearestDuplicate(vector, [{ id: "other", vector: [0, 1, 0] }])).toBeNull();
  });
});

describe("feedback mining", () => {
  it("suggests a repeated liked phrase and a repeated disliked phrase", () => {
    const result = mineSuggestions(
      ["อยากได้ การ์ดจอ ด่วนในเชียงใหม่", "ตามหา การ์ดจอ สภาพดี"],
      ["ชวนเล่น พนัน ออนไลน์ทุกวัน", "โปรโมชั่น พนัน ใหม่"],
      [],
      [],
    );
    expect(result.watch.map((item) => item.word)).toContain("การ์ดจอ");
    expect(result.forbidden.map((item) => item.word)).toContain("พนัน");
  });

  it("raises the score when category weight and a liked centroid agree", () => {
    const vector = [1, 0];
    const delta = preferenceScore(
      [{ kind: "category", key: "it", weight: 3 }],
      { category: "it", keywords: [], sourceId: "s", author: "" },
      vector,
      [1, 0],
      [0, 1],
    );
    expect(delta).toBeGreaterThan(0.4);
  });
});

describe("daily summary", () => {
  it("sends once per day at the configured clock", () => {
    expect(shouldSendSummary("08:00", "08:00", null, "2026-11-02")).toBe(true);
    expect(shouldSendSummary("08:01", "08:00", null, "2026-11-02")).toBe(false);
    expect(shouldSendSummary("08:00", "08:00", "2026-11-02", "2026-11-02")).toBe(false);
  });

  it("lists yesterday's count and the hottest lead", () => {
    const summary = buildSummary("2026-11-01", [
      { text: "หาการ์ดจอ", score: 90, url: "https://fb.example/1", category: "อุปกรณ์ไอที", keywords: ["การ์ดจอ"], sourceName: "กลุ่มคอม", intent: "buyer", isAd: false },
      { text: "โปรโมชั่น", score: 8, url: "https://fb.example/2", category: "อื่นๆ", keywords: [], sourceName: "กลุ่มสแปม", intent: "seller", isAd: true },
    ]);
    expect(summary.body).toContain("ลีดเมื่อวาน 1 รายการ");
    expect(summary.body).toContain("หาการ์ดจอ");
    expect(summary.body).toContain("กลุ่มคอม");
  });
});
