import { describe, expect, it } from "vitest";
import { flattenSeeds } from "../../src/lib/pipeline/catalog";
import { contentHash, normalizeText } from "../../src/lib/pipeline/normalize";
import { detectIntent } from "../../src/lib/pipeline/intent";
import { selectReadyProviders } from "../../src/lib/ai/health";
import { resolveGroqModel, DEFAULT_GROQ_MODEL } from "../../src/lib/ai/models";
import { sourceIsStale } from "../../src/lib/extension-health";
import type { AppSettings } from "../../src/lib/settings";
import { dedupeBatch } from "../../src/lib/pipeline/dedupe";
import { matchKeywords } from "../../src/lib/pipeline/keywords";
import { classifyWithChain } from "../../src/lib/pipeline/classify";
import { classifyByRules } from "../../src/lib/pipeline/classify-rules";
import { scoreAd } from "../../src/lib/pipeline/ad-filter";
import { extractProvince, PROVINCES } from "../../src/lib/pipeline/province";
import { mapRssItems } from "../../src/lib/rss";
import { extractWebBoardPosts } from "../../src/lib/web-board";

const catalog = flattenSeeds();

describe("dedupe", () => {
  it("treats the same post as one lead after whitespace, case, and tracking params", () => {
    const left = contentHash("  ตามหา  การ์ดจอ  ", "https://facebook.com/groups/1/posts/2?fbclid=abc&utm_source=share");
    const right = contentHash("ตามหา การ์ดจอ", "https://www.facebook.com/groups/1/posts/2/");
    expect(left).toBe(right);
  });

  it("keeps Thai vowels and tone marks", () => {
    expect(normalizeText("ขอนแก่น")).toBe("ขอนแก่น");
    expect(normalizeText("รับซื้อ")).toBe("รับซื้อ");
    expect(normalizeText("  รับ  ")).toBe("รับ");
  });

  it("keeps different text as different leads", () => {
    const left = contentHash("รับซื้อการ์ดจอ", "https://www.facebook.com/groups/1/posts/2");
    const right = contentHash("ขายการ์ดจอ", "https://www.facebook.com/groups/1/posts/2");
    expect(left).not.toBe(right);
  });

  it("drops hashes already stored and repeats inside the same batch", () => {
    const items = [
      { hash: "a", text: "หนึ่ง" },
      { hash: "b", text: "สอง" },
      { hash: "b", text: "สองซ้ำ" },
    ];
    const result = dedupeBatch(items, ["a"]);
    expect(result.fresh.map((item) => item.text)).toEqual(["สอง"]);
    expect(result.duplicates).toHaveLength(2);
  });
});

describe("keyword matching", () => {
  it("flags watch words and blocks a lead when a forbidden word is present", () => {
    const result = matchKeywords("อยากได้การ์ดจอ แต่เป็นโพสต์พนัน", [
      { word: "อยากได้", type: "watch" },
      { word: "พนัน", type: "forbidden" },
    ]);
    expect(result.watch).toContain("อยากได้");
    expect(result.forbidden).toContain("พนัน");
    expect(result.matched).toBe(false);
  });

  it("matches regardless of English casing", () => {
    const result = matchKeywords("Looking for SSD มือสอง", [{ word: "ssd", type: "watch" }]);
    expect(result.matched).toBe(true);
  });
});

describe("classifier fallback", () => {
  const text = "ตามหาคนรับเติมเกม freefire ในเชียงใหม่ อยากได้";

  it("uses rules when every AI provider fails", async () => {
    const result = await classifyWithChain({
      posts: [{ id: "1", text }],
      catalog,
      providers: [
        { name: "ollama", classify: async () => { throw new Error("down"); } },
        { name: "gemini", classify: async () => { throw new Error("429"); } },
        { name: "groq", classify: async () => { throw new Error("no key"); } },
      ],
    });
    expect(result.provider).toBe("rules");
    expect(result.errors.map((item) => item.name)).toEqual(["ollama", "gemini", "groq"]);
    expect(result.results[0]).toMatchObject({
      categorySlug: "games",
      subcategorySlug: "game-topup",
      intent: "buyer",
      province: "เชียงใหม่",
      isAd: false,
    });
    expect(result.results[0].suggestedReply).toContain("เติมเกม");
  });

  it("keeps a successful provider ahead of the rule fallback", async () => {
    const result = await classifyWithChain({
      posts: [{ id: "9", text: "สวัสดีครับ มีอะไรแนะนำไหม" }],
      catalog,
      providers: [
        {
          name: "groq",
          classify: async () => [
            {
              id: "9",
              categorySlug: "freelance",
              intent: "buyer",
              province: "ขอนแก่น",
              isAd: false,
              suggestedReply: "สนใจงานฟรีแลนซ์ครับ",
            },
          ],
        },
      ],
    });
    expect(result.provider).toBe("groq");
    expect(result.results[0].categorySlug).toBe("freelance");
    expect(result.results[0].province).toBe("ขอนแก่น");
    expect(result.results[0].suggestedReply).toBe("สนใจงานฟรีแลนซ์ครับ");
  });
});

describe("intent", () => {
  it("treats หาคนรับ... as a buyer even when the service word looks like a seller", () => {
    expect(detectIntent("หาคนรับเติมเพชร ROV ด่วน")).toBe("buyer");
    expect(detectIntent("รบกวนแนะนำร้านรับทำเว็บ")).toBe("buyer");
  });

  it("treats a top-up offer as a seller", () => {
    expect(detectIntent("รับเติมเพชร ROV พร้อมส่ง")).toBe("seller");
    expect(detectIntent("ขายการ์ดจอมือสอง")).toBe("seller");
    expect(detectIntent("พร้อมส่งไอโฟน")).toBe("seller");
    expect(detectIntent("รับออกแบบโลโก้")).toBe("seller");
    expect(detectIntent("รับทำเว็บไซต์ร้านค้า")).toBe("seller");
  });

  it("treats looking phrases as buyers", () => {
    expect(detectIntent("หา iPad มือสอง")).toBe("buyer");
    expect(detectIntent("อยากได้ข้าวมันไก่ส่งบ้าน")).toBe("buyer");
    expect(detectIntent("พอรู้จักร้านซ่อมไอแพดมั้ย")).toBe("buyer");
    expect(detectIntent("ตามหาแท็บเล็ตให้น้อง")).toBe("buyer");
  });
});

describe("ai provider selection", () => {
  it("skips an unavailable provider without dropping the next one", async () => {
    const settings = {
      geminiApiKey: "",
      groqApiKey: "test-key",
    } as AppSettings;
    const seen: string[] = [];
    const result = await selectReadyProviders(["ollama", "gemini", "groq"], settings, async (name) => {
      seen.push(name);
      if (name === "ollama") return { ok: false, message: "connection refused" };
      return { ok: true, message: "พร้อม" };
    });
    expect(seen).toEqual(["ollama", "groq"]);
    expect(result.ready).toEqual(["groq"]);
    expect(result.errors.map((item) => item.name)).toEqual(["ollama", "gemini"]);
  });

  it("replaces the retired Groq instant model", () => {
    expect(resolveGroqModel("llama-3.1-8b-instant")).toBe(DEFAULT_GROQ_MODEL);
    expect(resolveGroqModel(DEFAULT_GROQ_MODEL)).toBe(DEFAULT_GROQ_MODEL);
  });
});

describe("extension silence", () => {
  it("flags an enabled group that has not reported for over 30 minutes", () => {
    const createdAt = new Date(Date.now() - 50 * 60 * 1000);
    expect(
      sourceIsStale({ enabled: true, type: "facebook_group", createdAt, lastExtensionAt: null }),
    ).toBe(true);
    expect(
      sourceIsStale({ enabled: true, type: "facebook_group", createdAt: new Date(), lastExtensionAt: null }),
    ).toBe(false);
  });
});

describe("province and ads", () => {
  it("lists the 77 provinces and skips ambiguous words without a prefix", () => {
    expect(PROVINCES).toHaveLength(77);
    expect(extractProvince("ไปเลยนะ")).toBeNull();
    expect(extractProvince("อยู่จังหวัดเลย")).toBe("เลย");
    expect(extractProvince("นัดรับของที่กทม")).toBe("กรุงเทพมหานคร");
  });

  it("flags shop spam and leaves a normal buyer post alone", () => {
    expect(scoreAd("โปรโมชั่นสั่งซื้อเลย ลดราคา ส่งฟรีทั่วไทย").isAd).toBe(true);
    expect(scoreAd("ตามหาคนรับเติมเกม freefire ในเชียงใหม่ อยากได้").isAd).toBe(false);
    expect(scoreAd("สั่งทาง Shopee https://shope.ee/abc").isAd).toBe(true);
    expect(scoreAd("เมนู KFC ลดราคา").isAd).toBe(true);
    expect(scoreAd("ลิงก์ GrabFood และ Lazada").isAd).toBe(true);
  });

  it("puts devices in IT and names food, services, and travel", () => {
    expect(classifyByRules("ขาย iPad มือสอง", catalog).categorySlug).toBe("it");
    expect(classifyByRules("อยากได้ไอโฟนเครื่องเล็ก", catalog).categorySlug).toBe("it");
    expect(classifyByRules("อยากได้ข้าวมันไก่ส่งบ้าน", catalog).categorySlug).toBe("food");
    expect(classifyByRules("หาช่างล้างแอร์ด่วน", catalog).categorySlug).toBe("services");
    expect(classifyByRules("รับส่งสนามบินดอนเมือง", catalog).categorySlug).toBe("travel");
  });
});

describe("non-facebook sources", () => {
  it("maps RSS items into posts", () => {
    const posts = mapRssItems([
      { link: "https://board.example/post/1", title: "รับซื้อโน้ตบุ๊ก", contentSnippet: "ในขอนแก่น", isoDate: "2026-11-01T00:00:00.000Z", creator: "เอ" },
      { link: "https://board.example/post/1", title: "ซ้ำ" },
    ]);
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain("รับซื้อโน้ตบุ๊ก");
    expect(posts[0].authorName).toBe("เอ");
  });

  it("reads topic links from a simple web board", () => {
    const html = `
      <main>
        <article class="topic">
          <a href="/t/88">รับออกแบบโลโก้ งานฟรีแลนซ์</a>
          <div class="author">มิน</div>
          <p>รับออกแบบโลโก้สำหรับร้านค้า ส่งไฟล์ให้ภายในสามวัน</p>
        </article>
      </main>`;
    const posts = extractWebBoardPosts(html, "https://board.example/latest");
    expect(posts[0].url).toBe("https://board.example/t/88");
    expect(posts[0].text).toContain("รับออกแบบโลโก้");
  });
});
