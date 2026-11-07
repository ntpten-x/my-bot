import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

function loadScripts(dom: JSDOM) {
  for (const file of ["selectors.js", "parser.js"]) {
    const script = dom.window.document.createElement("script");
    script.textContent = readFileSync(path.join(process.cwd(), "extension", file), "utf8");
    dom.window.document.body.appendChild(script);
  }
}

function parseFixture(name: string) {
  const html = readFileSync(path.join(process.cwd(), "extension/fixtures", name), "utf8");
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    runScripts: "dangerously",
    url: "https://www.facebook.com/groups/1",
  });
  loadScripts(dom);
  return dom.window.MyBotParser.parseFacebookPosts(dom.window.document);
}

describe("facebook parser", () => {
  it("reads article posts with author, permalink, time, and images", () => {
    const posts = parseFixture("group-feed.html");
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      authorName: "สมชาย ใจดี",
      text: "ตามหาคนรับเติมเกม freefire ในเชียงใหม่ อยากได้",
    });
    expect(posts[0].url).toContain("/groups/123/posts/999");
    expect(posts[0].postedAt).toBe(new Date(1730000000 * 1000).toISOString());
    expect(posts[0].images).toEqual(["https://scontent.xx.fbcdn.net/v/photo.jpg"]);
    expect(posts[1].authorName).toBe("ร้านไอที");
    expect(posts[1].text).toContain("ขายการ์ดจอ");
    expect(posts[1].postedAt).toBe("2026-11-01T08:00:00+07:00");
  });

  it("falls back to aria and data attributes when role=article is missing", () => {
    const posts = parseFixture("fallback-feed.html");
    expect(posts).toHaveLength(1);
    expect(posts[0].authorName).toBe("น้องเมย์");
    expect(posts[0].text).toContain("รับซื้อโน้ตบุ๊ก");
    expect(posts[0].url).toContain("/groups/market/posts/42");
  });

  it("returns nothing for an empty document", () => {
    const dom = new JSDOM("<!doctype html><body></body>", {
      runScripts: "dangerously",
      url: "https://www.facebook.com/groups/1",
    });
    loadScripts(dom);
    expect(dom.window.MyBotParser.parseFacebookPosts(dom.window.document)).toEqual([]);
  });

  it("keeps distinct single-post multi_permalinks without promoting a comment-only link to a send target", () => {
    // SYNTHETIC markup only. Each article represents its own post, not a comment.
    const dom = new JSDOM(`<body>
      <article role="article"><a href="/groups/12345?multi_permalinks=111">เวลา</a><div data-ad-preview="message">ขายสินค้าทดสอบรายการแรก</div></article>
      <article role="article"><a href="/groups/12345?multi_permalinks=222">เวลา</a><div data-ad-preview="message">ขายสินค้าทดสอบรายการสอง</div></article>
      <article role="article"><a href="/groups/12345/posts/333?comment_id=444&amp;__cft__[0]=tracking">เวลา</a><div data-ad-preview="message">ขายสินค้าทดสอบรายการสาม</div></article>
    </body>`, { runScripts: "dangerously", url: "https://www.facebook.com/groups/12345" });
    loadScripts(dom);
    expect(dom.window.MyBotParser.parseFacebookPosts(dom.window.document).map((post: { url: string }) => post.url)).toEqual([
      "https://www.facebook.com/groups/12345/posts/111/", "https://www.facebook.com/groups/12345/posts/222/", "https://www.facebook.com/groups/12345/posts/333?comment_id=444&__cft__[0]=tracking",
    ]);
  });

  it("prefers a direct group permalink and does not interpret a multi-post collection as one post", () => {
    const dom = new JSDOM(`<body><article role="article">
      <a href="/groups/alias/posts/111?comment_id=999">คอมเมนต์</a><a href="/groups/12345?multi_permalinks=111">เวลา</a><a href="/groups/alias/posts/111">เวลาโพสต์</a>
      <div data-ad-preview="message">ขายสินค้าทดสอบรายการแรก</div></article>
      <article role="article"><a href="/groups/12345?multi_permalinks=222,333">หลายโพสต์</a><div data-ad-preview="message">ขายสินค้าทดสอบรายการสอง</div></article>
      <article role="article"><a href="https://evilfacebook.com/groups/12345/posts/444">ปลอม</a><div data-ad-preview="message">ขายสินค้าทดสอบรายการสาม</div></article>
    </body>`, { runScripts: "dangerously", url: "https://www.facebook.com/groups/12345" });
    loadScripts(dom);
    expect(dom.window.MyBotParser.parseFacebookPosts(dom.window.document).map((post: { url: string }) => post.url)).toEqual(["https://www.facebook.com/groups/alias/posts/111/"]);
  });
});

describe("facebook parser — See more and Marketplace (synthetic fixtures)", () => {
  function domFor(name: string, url: string) {
    const html = readFileSync(path.join(process.cwd(), "extension/fixtures", name), "utf8");
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "dangerously", url });
    loadScripts(dom);
    return dom;
  }

  it("drops the inline See more toggle text without touching it", () => {
    const dom = domFor("see-more-feed.html", "https://www.facebook.com/groups/123");
    const toggle = dom.window.document.querySelector('[role="button"]')!;
    const posts = dom.window.MyBotParser.parseFacebookPosts(dom.window.document);
    expect(posts).toHaveLength(1);
    expect(posts[0].text).not.toMatch(/ดูเพิ่มเติม/);
    expect(posts[0].text).toMatch(/^หาช่างซ่อมแอร์ด่วน แถวนิมมาน ใครว่างบ้างครับ/);
    expect(posts[0].text).toMatch(/…$/);
    expect(toggle.textContent).toBe("ดูเพิ่มเติม");
  });

  it("reads Marketplace listing cards into seller posts", () => {
    const dom = domFor("marketplace-search.html", "https://www.facebook.com/marketplace/chiangmai/search?query=iphone");
    const listings = dom.window.MyBotParser.parseMarketplaceListings(dom.window.document);
    // duplicate card, category link and a price-only card without a title are skipped
    expect(listings).toHaveLength(2);
    expect(listings[0]).toMatchObject({
      url: "https://www.facebook.com/marketplace/item/111222333444/",
      title: "iPhone 13 128GB สภาพดี",
      price: "฿12,500",
      location: "เชียงใหม่",
      kind: "marketplace",
      postedAt: null,
      images: ["https://scontent.xx.fbcdn.net/v/listing-1.jpg"],
    });
    expect(listings[0].text).toBe("ขาย iPhone 13 128GB สภาพดี ราคา ฿12,500 · เชียงใหม่");
    expect(listings[1]).toMatchObject({ price: "ฟรี", title: "โต๊ะไม้เก่า มารับเอง", location: "Bangkok, Thailand" });
    expect(listings[1].images).toEqual(["https://scontent.xx.fbcdn.net/v/listing-2.jpg"]);
  });
});
