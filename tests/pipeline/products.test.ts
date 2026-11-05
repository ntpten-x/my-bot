import { describe, expect, it } from "vitest";
import { PRODUCT_SEEDS, matchProducts, normalizeForAlias, parseAliases, pickProduct, productPrompt, suggestGroupProduct } from "../../src/lib/pipeline/products";
import { AI_SYSTEM, setProductList, userPrompt } from "../../src/lib/ai/prompt";
import { sanitizeAiItem } from "../../src/lib/pipeline/classify-rules";

const top = (text: string) => matchProducts(text, PRODUCT_SEEDS)[0]?.slug ?? null;

describe("product taxonomy (level 3)", () => {
  it("normalizes fancy letters and zero-width characters", () => {
    expect(normalizeForAlias("𝑹𝒐𝒃𝒍𝒐𝒙\u200b")).toBe("roblox");
    expect(top("ขายไอดี 𝑹𝒐𝒃𝒍𝒐𝒙 ราคาถูก")).toBe("roblox");
  });

  it("matches Thai and English aliases at word boundaries", () => {
    expect(top("รับเติมโรบัค ราคาถูก")).toBe("roblox");
    expect(top("ขายไอดี rov แรงค์สูง")).toBe("rov");
    expect(top("เติมเพชร 100ff ด่วน")).toBe("free-fire");
    expect(top("special offer today")).toBeNull();
    expect(top("ขวดน้ำ 500ml")).toBeNull();
    expect(top("หาครูสอนพิเศษที่โรงเรียน")).toBeNull();
    expect(top("ขาย iPhone 15 pro max")).toBe("iphone");
  });

  it("rules beat the AI, the AI beats the group, category mismatches are dropped", () => {
    expect(pickProduct({ text: "ขาย roblox", categorySlug: "games", aiSlug: "rov", groupProduct: "pubg" }, PRODUCT_SEEDS)).toEqual({ slug: "roblox", by: "rules" });
    expect(pickProduct({ text: "ขายไอดีเกม", categorySlug: "games", aiSlug: "rov", groupProduct: "pubg" }, PRODUCT_SEEDS)).toEqual({ slug: "rov", by: "ai" });
    expect(pickProduct({ text: "ขายไอดีเกม", categorySlug: "games", aiSlug: "not-in-list", groupProduct: "pubg" }, PRODUCT_SEEDS)).toEqual({ slug: "pubg", by: "group" });
    expect(pickProduct({ text: "ขายไอดีเกม", categorySlug: "it", aiSlug: "rov", groupProduct: "pubg" }, PRODUCT_SEEDS)).toEqual({ slug: null, by: "none" });
  });

  it("suggests a group product only when it clearly dominates", () => {
    expect(suggestGroupProduct({ roblox: 8, rov: 2 })?.slug).toBe("roblox");
    expect(suggestGroupProduct({ roblox: 5, rov: 5 })).toBeNull();
    expect(suggestGroupProduct({ roblox: 3 })).toBeNull();
  });

  it("keeps the product list compact and the system prompt under its limit", () => {
    const list = productPrompt(PRODUCT_SEEDS);
    expect(list).toContain("games:");
    expect(list.length).toBeLessThan(600);
    expect(AI_SYSTEM.length).toBeLessThan(1100);
    expect(AI_SYSTEM).toContain("productSlug");
    setProductList(list);
    expect(userPrompt([{ id: "p1", text: "ขาย roblox" }] as never, [] as never)).toContain("roblox");
    setProductList("");
  });

  it("parses aliases and passes the AI product slug through sanitize", () => {
    expect(parseAliases("a, b\nb ,c")).toEqual(["a", "b", "c"]);
    const item = sanitizeAiItem({ id: "x", productSlug: " Roblox " } as never, { id: "x", text: "ขาย" } as never, []);
    expect(item.productSlug).toBe("roblox");
  });
});
