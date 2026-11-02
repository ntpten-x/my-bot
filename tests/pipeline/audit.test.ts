import { describe, expect, it } from "vitest";
import { fetchErrorReason } from "../../src/lib/fetch-error";
import { STUCK_JOB_MS } from "../../src/lib/ai/queue";
import { OLLAMA_KEEP_ALIVE } from "../../src/lib/ai/ollama-url";
import { ocrRunsInThisProcess } from "../../src/lib/ocr";
import { rankHybrid } from "../../src/lib/smart/search";
import { publicHealth } from "../../src/lib/version";

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
});
