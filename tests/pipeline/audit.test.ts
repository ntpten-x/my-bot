import { describe, expect, it } from "vitest";
import { fetchErrorReason } from "../../src/lib/fetch-error";
import { STUCK_JOB_MS } from "../../src/lib/ai/queue";
import { OLLAMA_KEEP_ALIVE } from "../../src/lib/ai/ollama-url";
import { ocrRunsInThisProcess } from "../../src/lib/ocr";
import { persistWorkerLine } from "../../src/lib/log";
import { rankHybrid } from "../../src/lib/smart/search";
import { findNearDuplicate } from "../../src/lib/smart/vector";
import { normalizeText } from "../../src/lib/pipeline/normalize";
import { flattenSeeds } from "../../src/lib/pipeline/catalog";
import { classifyByRules, foodOverride, sanitizeAiItem } from "../../src/lib/pipeline/classify-rules";
import { detectIntent } from "../../src/lib/pipeline/intent";
import { publicHealth } from "../../src/lib/version";
import { captureText, chooseKeeper, mergePermalinks, sameSourceCapture } from "../../src/lib/pipeline/capture";
import { maskSecret, shouldInsertDemoPosts } from "../../src/lib/seed-policy";

describe("audit fixes", () => {
  it("returns a public health payload with only ok and version", () => {
    const payload = publicHealth();
    expect(payload.ok).toBe(true);
    expect(payload.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(payload).sort()).toEqual(["ok", "version"]);
  });

  it("resets a stuck AI job after two minutes and keeps OCR inside the worker", () => {
    expect(STUCK_JOB_MS).toBe(2 * 60 * 1000);
    expect(OLLAMA_KEEP_ALIVE).toBe("30m");
    const previous = process.env.MYBOT_PROCESS;
    delete process.env.MYBOT_PROCESS;
    expect(ocrRunsInThisProcess()).toBe(false);
    process.env.MYBOT_PROCESS = "worker";
    expect(ocrRunsInThisProcess()).toBe(true);
    if (previous === undefined) delete process.env.MYBOT_PROCESS;
    else process.env.MYBOT_PROCESS = previous;
  });

  it("keeps a reason on fetch failures", () => {
    expect(fetchErrorReason(new Error("HTTP 404 Not Found"), "RSS")).toBe("RSS: HTTP 404 Not Found");
    expect(fetchErrorReason("", "เว็บบอร์ด")).toBe("เว็บบอร์ด: ไม่ทราบสาเหตุ");
  });

  it("swallows a locked log file instead of failing the job", async () => {
    const wrote = await persistWorkerLine("{\"message\":\"job\"}", async () => {
      const error = new Error("EBUSY: resource busy or locked");
      (error as NodeJS.ErrnoException).code = "EBUSY";
      throw error;
    });
    expect(wrote).toBe(false);
  });

  it("links the same normalized text across groups and outside the time window", () => {
    const text = normalizeText("MS240883เริ่มส่็1ทุ่ม ส่งของถึงบ้าน พร้อมกล่องทุกออเดอร์");
    const match = findNearDuplicate({
      sourceId: "group-new",
      normalizedText: text,
      vector: null,
      createdAt: Date.now(),
      others: [
        {
          id: "older",
          sourceId: "group-old",
          normalizedText: text,
          vector: null,
          createdAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
        },
      ],
    });
    expect(match).toEqual({ id: "older", reason: "text" });
  });

  it("turns a ready-to-ship meatball salad into a food seller and ads out of buyer", () => {
    const catalog = flattenSeeds();
    const text = "ยำลูกชิ้นกุ้ง ส่งด่วน พร้อมส่ง";
    expect(detectIntent(text)).toBe("seller");
    expect(classifyByRules(text, catalog).categorySlug).toBe("food");
    const overridden = sanitizeAiItem({ id: "1", categorySlug: "other", intent: "buyer", isAd: false }, { id: "1", text }, catalog);
    expect(overridden.categorySlug).toBe("food");
    expect(overridden.intent).toBe("seller");
    const ad = sanitizeAiItem(
      { id: "2", categorySlug: "food", intent: "buyer", isAd: false },
      { id: "2", text: "อาหาร ของกิน สั่งซื้อเลย โปรโมชั่น ส่งฟรีทั่วไทย" },
      catalog,
    );
    expect(ad.intent).toBe("ad");
    expect(ad.isAd).toBe(true);
  });

  it("ranks an iPad lead ahead of a closer but unrelated vector and drops duplicate text", () => {
    const posts = [
      { id: "food", text: "ขายข้าวมันไก่ส่งบ้าน" },
      { id: "ipad", text: "ขาย iPad มือสอง สภาพดี พร้อมกล่อง" },
      { id: "dup", text: "ขาย iPad มือสอง สภาพดี พร้อมกล่อง" },
      { id: "clean", text: "รับทำความสะอาดคอนโด" },
    ];
    const semantic = new Map<string, number>([
      ["food", 0.99],
      ["ipad", 0.4],
      ["dup", 0.4],
      ["clean", 0.85],
    ]);
    const ranked = rankHybrid("ขาย iPad มือสอง", posts, semantic);
    expect(ranked[0]?.id).toBe("ipad");
    expect(ranked.filter((post) => post.text.includes("iPad"))).toHaveLength(1);
  });

  it("ranks a food post ahead of a food ad for อาหาร ของกิน", () => {
    const posts = [
      { id: "ad", text: "อาหาร ของกิน สั่งซื้อเลย โปรโมชั่น ส่งฟรีทั่วไทย", isAd: true },
      { id: "food", text: "ร้านอาหาร ของกิน ข้าวมันไก่ ส่งในซอย", isAd: false },
    ];
    const semantic = new Map<string, number>([
      ["ad", 0.99],
      ["food", 0.15],
    ]);
    expect(rankHybrid("อาหาร ของกิน", posts, semantic)[0]?.id).toBe("food");
  });

  it("treats a truncated Facebook capture as a prefix of the longer post in the same group", () => {
    const stem = "MS240883คิวว่างวันนี้เริ่มส่งยำลูกชิ้นกุ้งของกินเมนูน้ำจิ้มผักสดส่งถึงบ้านก่อนหนึ่งทุ่ม";
    expect(captureText(stem).length).toBeGreaterThanOrEqual(60);
    const truncated = `${stem}...ดูเพิ่มเติม`;
    const full = `${stem} พร้อมกล่องและรับที่ร้านได้จนหมดคิว`;
    expect(captureText(truncated).startsWith(captureText(stem))).toBe(true);
    expect(sameSourceCapture({ sourceId: "g1", text: truncated }, { sourceId: "g1", text: full })).toBe("right");
    expect(sameSourceCapture({ sourceId: "g1", text: full }, { sourceId: "g2", text: truncated })).toBeNull();
    expect(chooseKeeper("สั้น", full)).toBeNull();
    expect(mergePermalinks("https://www.facebook.com/groups/a/posts/9", [["https://www.facebook.com/groups/a/posts/3", "https://www.facebook.com/groups/a/posts/9"]])).toEqual([
      "https://www.facebook.com/groups/a/posts/3",
    ]);
  });

  it("overrides an IT label when the post is a food vendor and has no device words", () => {
    const catalog = flattenSeeds();
    const text = "MS240883คิวว่างวันนี้ เริ่มส่งยำ เมนูของกิน";
    expect(foodOverride(text)).toBe(true);
    expect(foodOverride("คิวว่าง ขาย iPad มือสอง")).toBe(false);
    const overridden = sanitizeAiItem(
      { id: "yam", categorySlug: "it", intent: "seller", isAd: false },
      { id: "yam", text },
      catalog,
    );
    expect(overridden.categorySlug).toBe("food");
    expect(classifyByRules("ขาย iPad มือสอง คิวว่าง", catalog).categorySlug).toBe("it");
  });

  it("skips demo posts after a real source or a cleaned demo, and masks the token", () => {
    expect(shouldInsertDemoPosts({ realSourceCount: 0, demoExists: false, demoEnabled: false, demoPostCount: 0 })).toBe(true);
    expect(shouldInsertDemoPosts({ realSourceCount: 1, demoExists: false, demoEnabled: false, demoPostCount: 0 })).toBe(false);
    expect(shouldInsertDemoPosts({ realSourceCount: 0, demoExists: true, demoEnabled: false, demoPostCount: 5 })).toBe(false);
    expect(shouldInsertDemoPosts({ realSourceCount: 0, demoExists: true, demoEnabled: true, demoPostCount: 0 })).toBe(false);
    const token = "fb84b894c8af0c02f35cf25c9d30910e814a00d927607b82";
    const masked = maskSecret(token);
    expect(masked).not.toBe(token);
    expect(masked.includes("b894c8af")).toBe(false);
    expect(masked.startsWith("fb")).toBe(true);
    expect(masked.endsWith("82")).toBe(true);
  });
});
