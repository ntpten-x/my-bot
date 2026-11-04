import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { flattenSeeds } from "@/lib/pipeline/catalog";
import { classifyByRules, ruleItem, sanitizeAiItem } from "@/lib/pipeline/classify-rules";
import { scoreLead, UNCLEAR_BUYER_CAP } from "@/lib/smart/score";
import { isExpansionOf, isTruncatedText } from "@/lib/pipeline/truncation";
import { AI_SYSTEM, PROMPT_TEXT_LIMIT, setOwnerExamples, userPrompt } from "@/lib/ai/prompt";
import { scoreAd } from "@/lib/pipeline/ad-filter";
import { OBVIOUS_AD_SCORE } from "@/lib/ai/queue";

const catalog = flattenSeeds();

// Real posts the classifier got wrong in the 2026-11-04 test run.
describe("classification fixes (real misclassified posts)", () => {
  it.each([
    ["ราคา99.- บาทพอ วิ่ง239B คูณ64 ทำเงินได้164B ไข่เยอะ ของพร้อมเล่นเลยครับ", "games", "game-id"],
    ["หารหัสหญิงล้วน งบ300-400", "games", "game-id"],
    ["ตัวแทนดันรหัส กลางได้ไม่รวม265 bath ทักมาเลย", "games", "game-boost"],
    ["#รหัสMS240685ส่งฟรีรอบม.ครับ 062-965-5364", "food", null],
    ["MS242366 หมี่ไก่ฉีก เริ่มต้นแค่ 59.คลุกซอสเข้มข้น…", "food", null],
  ])("rules put %s in %s", (text, category, sub) => {
    expect(classifyByRules(text, catalog)).toEqual({ categorySlug: category, subcategorySlug: sub });
  });

  it("overrides an AI answer of IT for game and shop-code posts", () => {
    const post = { id: "p", text: "ตัวแทนดันรหัส กลางได้ไม่รวม265 bath" };
    expect(sanitizeAiItem({ id: "p", categorySlug: "it", intent: "buyer" }, post, catalog)).toMatchObject({ categorySlug: "games", subcategorySlug: "game-boost" });
    const shop = { id: "s", text: "MS242366 หมี่ไก่ฉีก เริ่มต้นแค่ 59.คลุกซอสเข้มข้น" };
    expect(sanitizeAiItem({ id: "s", categorySlug: "other", intent: "buyer" }, shop, catalog)).toMatchObject({ categorySlug: "food", intent: "seller" });
  });

  it("does not treat a gaming notebook as a game post", () => {
    expect(classifyByRules("ขายโน้ตบุ๊กเล่นเกม RTX 3060", catalog).categorySlug).toBe("it");
  });

  it("reads 'หารหัส…' as a buyer", () => {
    expect(ruleItem({ id: "x", text: "หารหัสหญิงล้วน งบ300-400" }, catalog).intent).toBe("buyer");
  });

  it.each([
    "ปกติไม่เคยดวงดีกับเขาเลย กดแบบไม่คาดหวังแต่ดันออก",
    "สอบถามหน่อยครับพี่ที่เล่นพับจีทำงานอะไรกันครับ",
  ])("caps the score when the model says buyer but the text is not: %s", (text) => {
    const { score, reason } = scoreLead({ text, intent: "buyer", isAd: false, forbidden: false, keywordHits: 0, ageHours: 1, sourceQuality: 1, signals: { urgency: 0.95, hasBudget: true, specificity: 1 } });
    expect(score).toBeLessThanOrEqual(UNCLEAR_BUYER_CAP);
    expect(reason).toContain("ยังไม่ชัดว่ากำลังหา");
  });

  it("keeps a real buyer score high", () => {
    const { score } = scoreLead({ text: "หา iPad มือสอง ด่วน งบ 8000", intent: "buyer", isAd: false, forbidden: false, keywordHits: 1, ageHours: 1, sourceQuality: 1 });
    expect(score).toBeGreaterThan(80);
  });
});

describe("truncated post text", () => {
  it("detects text cut at See more", () => {
    expect(isTruncatedText("หาช่างซ่อมแอร์ด่วน…")).toBe(true);
    expect(isTruncatedText("MS242366 หมี่ไก่ฉีก … See more")).toBe(true);
    expect(isTruncatedText("หาช่างซ่อมแอร์ด่วน")).toBe(false);
  });

  it("accepts only a longer text with the same start", () => {
    expect(isExpansionOf("หาช่างซ่อมแอร์ด่วน แถวนิมมาน…", "หาช่างซ่อมแอร์ด่วน แถวนิมมาน ใครว่างบ้างครับ โทร 08x")).toBe(true);
    expect(isExpansionOf("หาช่างซ่อมแอร์ด่วน แถวนิมมาน…", "ขายบ้าน เชียงใหม่ ราคาดี")).toBe(false);
    expect(isExpansionOf("หาช่างซ่อมแอร์ด่วน แถวนิมมาน", "หาช่างซ่อมแอร์ด่วน แถวนิมมาน ใครว่าง")).toBe(false);
  });

  it("parser reads the full text from a hidden node without clicking", () => {
    const html = `<div role="article">
      <a href="https://www.facebook.com/groups/1/posts/55/">time</a>
      <div data-ad-preview="message">หาช่างซ่อมแอร์ด่วน แถวนิมมาน ใครว่าง <div role="button">ดูเพิ่มเติม</div></div>
      <div dir="auto" style="display:none">หาช่างซ่อมแอร์ด่วน แถวนิมมาน ใครว่างบ้างครับ วันนี้ก่อนบ่ายสาม งบ 1500</div>
    </div>`;
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "dangerously", url: "https://www.facebook.com/groups/1" });
    for (const file of ["selectors.js", "parser.js"]) {
      const script = dom.window.document.createElement("script");
      script.textContent = readFileSync(path.join(process.cwd(), "extension", file), "utf8");
      dom.window.document.body.appendChild(script);
    }
    const posts = dom.window.MyBotParser.parseFacebookPosts(dom.window.document);
    expect(posts[0].text).toContain("งบ 1500");
    expect(posts[0].truncated).toBe(false);
  });
});

describe("AI prompt and ad shortcut", () => {
  it("is short and slices post text", () => {
    expect(AI_SYSTEM.length).toBeLessThan(1100);
    const prompt = userPrompt([{ id: "a", text: "x".repeat(3000) }], catalog);
    expect(prompt).toContain("x".repeat(PROMPT_TEXT_LIMIT));
    expect(prompt).not.toContain("x".repeat(PROMPT_TEXT_LIMIT + 1));
  });

  it("adds the owner's corrections as examples", () => {
    setOwnerExamples([{ text: "หารหัสหญิงล้วน งบ300", label: "games/game-id" }]);
    expect(userPrompt([{ id: "a", text: "t" }], catalog)).toContain('"หารหัสหญิงล้วน งบ300" = games/game-id');
    setOwnerExamples([]);
  });

  it("only very ad-like text skips the model", () => {
    expect(scoreAd("หา iPad มือสอง งบ 8000").score).toBeLessThan(OBVIOUS_AD_SCORE);
  });
});
