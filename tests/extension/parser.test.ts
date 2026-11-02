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
});
