import { describe, expect, it } from "vitest";
import { flattenSeeds } from "@/lib/pipeline/catalog";
import { classifyByRules, foodBlockedByGroup, ruleItem, sanitizeAiItem, squeezeRepeats } from "@/lib/pipeline/classify-rules";
import { detectIntent } from "@/lib/pipeline/intent";
import { dominantHint, hintLabel, isDominant } from "@/lib/pipeline/group-profile";
import { accuracyFrom } from "@/lib/classification-stats";
import { reclassWhere } from "@/lib/reclassify";
import { userPrompt } from "@/lib/ai/prompt";

const catalog = flattenSeeds();
const games = { categorySlug: "games", share: 0.85, total: 120 };

describe("classification v2: group profile, slang, chat, middleman", () => {
  it("collapses repeated letters before matching", () => {
    expect(squeezeRepeats("มาเติมม")).toBe("มาเติม");
    expect(squeezeRepeats("มาเตืมคิวว่าง")).toContain("เติม");
  });

  it.each([
    ["80โร 101 เพ้ด", "game-topup"],
    ["โรพลัสเรท3 ถูกๆ", "game-topup"],
    ["รับเติมโรแท้ ไว", "game-topup"],
    ["หาติดเวด ไอเทมครบ", "game-id"],
  ])("reads Roblox slang %s", (text, sub) => {
    expect(classifyByRules(text, catalog, games)).toMatchObject({ categorySlug: "games", subcategorySlug: sub });
  });

  it("bare 'เติม' is a top-up only inside a game group", () => {
    expect(classifyByRules("มาเติมม คิวว่าง", catalog, games)).toMatchObject({ categorySlug: "games", subcategorySlug: "game-topup" });
    expect(classifyByRules("เติมน้ำมันฟรี", catalog, games).subcategorySlug).not.toBe("game-topup");
  });

  it("finds a game middleman", () => {
    expect(classifyByRules("หากลางเครดิต แลกรหัส", catalog, games)).toMatchObject({ categorySlug: "games", subcategorySlug: "game-middleman" });
    expect(classifyByRules("ตัวแทนดันรหัส กลางได้ไม่รวม265 bath", catalog)).toMatchObject({ subcategorySlug: "game-boost" });
  });

  it("blocks the food rule in a game group unless there is a shop code or clear menu", () => {
    expect(foodBlockedByGroup("ไก่ตัน ขายถูก", games)).toBe(true);
    expect(classifyByRules("ไก่ตัน ขายถูก", catalog, games).categorySlug).toBe("games");
    expect(classifyByRules("MS242366 หมี่ไก่ฉีก เริ่มต้นแค่ 59", catalog, games).categorySlug).toBe("food");
    expect(classifyByRules("ไก่ตัน ขายถูก", catalog).categorySlug).not.toBe("games");
  });

  it("turns an AI food label into the group's category in a game group", () => {
    const post = { id: "p", text: "ไก่ตัน 50", groupHint: games };
    expect(sanitizeAiItem({ id: "p", categorySlug: "food", intent: "seller" }, post, catalog).categorySlug).toBe("games");
  });

  it("detects chat posts", () => {
    expect(detectIntent("มาคุยกันเรื่อง Live วันนี้ ใครเคยเจอบ้าง")).toBe("chat");
    expect(detectIntent("ขายรหัส ราคา 300")).not.toBe("chat");
    const item = sanitizeAiItem({ id: "c", categorySlug: "games", intent: "chat" }, { id: "c", text: "มาคุยกันเรื่องเกม" }, catalog);
    expect(item.intent).toBe("chat");
    expect(item.isAd).toBe(false);
  });

  it("builds a dominant group hint and passes it to the prompt", () => {
    expect(dominantHint({ games: 9 })).toBeNull();
    const hint = dominantHint({ games: 80, food: 10, other: 30 });
    expect(hint?.categorySlug).toBe("games");
    expect(isDominant({ ...games }, "games")).toBe(true);
    expect(hintLabel(games)).toContain("games");
    expect(userPrompt([{ id: "p", text: "80โร", groupHint: games }], catalog)).toContain("games");
    expect(ruleItem({ id: "x", text: "80โร", groupHint: games }, catalog).categorySlug).toBe("games");
  });

  it("computes per-group accuracy", () => {
    expect(accuracyFrom(0, 0)).toBeNull();
    expect(accuracyFrom(10, 3)).toBeCloseTo(0.7);
    expect(accuracyFrom(2, 5)).toBe(0);
  });

  it("re-classification never touches owner labels and respects the weekly cooldown", () => {
    const where = JSON.stringify(reclassWhere(Date.parse("2026-11-05T00:00:00Z"), "cat_other"));
    expect(where).toContain('"aiProvider":"owner"');
    expect(where).toContain("cat_other");
    expect(where).toContain("2026-10-29");
  });
});
