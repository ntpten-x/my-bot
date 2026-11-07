import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseFbTime } = require("../../extension/fbtime.js") as { parseFbTime: (s: string, now?: number) => string | null };
import { isWithinMaxAge, parseDate } from "@/lib/ingest";
import { facebookGroupKey } from "@/lib/sources";

// 2026-11-04 16:00 in Bangkok
const NOW = Date.parse("2026-11-04T09:00:00Z");

describe("parseFbTime (Asia/Bangkok)", () => {
  it.each([
    ["เมื่อสักครู่", "2026-11-04T09:00:00.000Z"],
    ["Just now", "2026-11-04T09:00:00.000Z"],
    ["5 นาที", "2026-11-04T08:55:00.000Z"],
    ["3 ชม.", "2026-11-04T06:00:00.000Z"],
    ["3 ชั่วโมงที่แล้ว", "2026-11-04T06:00:00.000Z"],
    ["3h", "2026-11-04T06:00:00.000Z"],
    ["15m", "2026-11-04T08:45:00.000Z"],
    ["an hour ago", "2026-11-04T08:00:00.000Z"],
    ["2 วัน", "2026-11-02T09:00:00.000Z"],
    ["1 สัปดาห์", "2026-10-28T09:00:00.000Z"],
    ["เมื่อวานนี้ เวลา 14:20", "2026-11-03T07:20:00.000Z"],
    ["เมื่อวาน เวลา 09:05 น.", "2026-11-03T02:05:00.000Z"],
    ["Yesterday at 2:20 PM", "2026-11-03T07:20:00.000Z"],
    ["วันนี้ เวลา 08:00", "2026-11-04T01:00:00.000Z"],
    ["2 พฤศจิกายน เวลา 10:00", "2026-11-02T03:00:00.000Z"],
    ["2 พ.ย. 2569 เวลา 10:00", "2026-11-02T03:00:00.000Z"],
    ["November 2 at 10:00 AM", "2026-11-02T03:00:00.000Z"],
    ["2 November 2026 at 22:15", "2026-11-02T15:15:00.000Z"],
    ["Nov 2, 2026", "2026-11-02T05:00:00.000Z"],
  ])("%s", (input, expected) => {
    expect(parseFbTime(input, NOW)).toBe(expected);
  });

  it("puts a future month without a year in the previous year", () => {
    expect(parseFbTime("15 ธันวาคม", NOW)).toBe("2025-12-15T05:00:00.000Z");
  });

  it.each(["ขายของมือสอง", "ตามหาช่าง 3 คน", "", "25:99", "เมื่อวาน เวลา บ่าย", "Shared with Public"])("rejects %j", (input) => {
    expect(parseFbTime(input, NOW)).toBeNull();
  });
});

describe("server parseDate", () => {
  it("accepts ISO and raw Facebook text, drops future times", () => {
    expect(parseDate("2026-11-01T08:00:00+07:00", NOW)?.toISOString()).toBe("2026-11-01T01:00:00.000Z");
    expect(parseDate("3 ชม.", NOW)?.toISOString()).toBe("2026-11-04T06:00:00.000Z");
    expect(parseDate("2027-01-01T00:00:00Z", NOW)).toBeNull();
    expect(parseDate("ไม่ใช่เวลา", NOW)).toBeNull();
    expect(parseDate(null, NOW)).toBeNull();
  });

  it("keeps posts inside 24 h and drops dated posts older than the window", () => {
    expect(isWithinMaxAge(null, 24, NOW)).toBe(true);
    expect(isWithinMaxAge(new Date(NOW - 23 * 3600_000), 24, NOW)).toBe(true);
    expect(isWithinMaxAge(new Date(NOW - 25 * 3600_000), 24, NOW)).toBe(false);
    expect(isWithinMaxAge(new Date(NOW - 30 * 3600_000), 48, NOW)).toBe(false);
  });
});

describe("facebookGroupKey", () => {
  it("normalizes group URLs to one key", () => {
    expect(facebookGroupKey("https://m.facebook.com/groups/KluayMan/?ref=share")).toBe("kluayman");
    expect(facebookGroupKey("https://web.facebook.com/groups/1053806704694002/posts/1")).toBe("1053806704694002");
    expect(facebookGroupKey("https://www.facebook.com/marketplace/bangkok/search?query=x")).toBe("");
  });
});

function parseHtml(html: string, url = "https://www.facebook.com/groups/1") {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: "dangerously", url });
  for (const file of ["selectors.js", "fbtime.js", "parser.js"]) {
    const script = dom.window.document.createElement("script");
    script.textContent = readFileSync(path.join(process.cwd(), "extension", file), "utf8");
    dom.window.document.body.appendChild(script);
  }
  return dom.window as unknown as { document: Document; MyBotParser: { parseFacebookPosts: (d: Document) => { authorName: string; postedAt: string | null }[]; readGroupId: (d: Document) => string } };
}

describe("parser post time + author", () => {
  it("reads the timestamp link text and aria-label", () => {
    const win = parseHtml(`
      <div role="article"><h3><span><a href="/groups/1/user/7/">วิไล ดีงาม</a></span></h3>
        <a href="/groups/1/posts/101/" aria-label="2 พฤศจิกายน เวลา 10:00">2 พ.ย.</a>
        <div dir="auto">ตามหาช่างซ่อมแอร์ด่วนครับ แถวบางนา</div></div>
      <div role="article"><h4><strong><span>นายดำ ขายดี</span></strong></h4>
        <a href="https://www.facebook.com/groups/1/permalink/202/"><span>เมื่อสักครู่</span></a>
        <div dir="auto">ขายรถเข็นมือสอง สภาพดีมาก</div></div>`);
    const posts = win.MyBotParser.parseFacebookPosts(win.document);
    expect(posts).toHaveLength(2);
    expect(posts[0].authorName).toBe("วิไล ดีงาม");
    expect(posts[0].postedAt).toMatch(/^2026-11-02T03:00:00.000Z$|^20\d\d-11-02T03:00:00.000Z$/);
    expect(posts[1].authorName).toBe("นายดำ ขายดี");
    expect(posts[1].postedAt).not.toBeNull();
  });

  it("reads the author from a group member link and ignores Follow/time text", () => {
    const win = parseHtml(`
      <div role="article"><h2><a href="/groups/1/posts/5/">3 ชม.</a></h2>
        <a href="/groups/1/user/55/" aria-label="สมหญิง ใจงาม"><img src="x.png"/></a>
        <div dir="auto">หาคนรับจ้างย้ายบ้าน วันเสาร์นี้</div></div>
      <div role="article"><h3><a href="/groups/1/user/9/">ชาย หนึ่ง · ติดตาม</a></h3>
        <a href="/groups/1/posts/6/">1 วัน</a><div dir="auto">ขายโต๊ะไม้สัก ราคาถูก</div></div>`);
    const posts = win.MyBotParser.parseFacebookPosts(win.document);
    expect(posts.map((post) => post.authorName)).toEqual(["สมหญิง ใจงาม", "ชาย หนึ่ง"]);
  });

  it("reads the numeric group id behind a vanity URL", () => {
    const links = Array.from({ length: 3 }, (_, i) => `<a href="/groups/1139456570695733/posts/${i}/">x</a>`).join("");
    const win = parseHtml(links, "https://www.facebook.com/groups/kluayman");
    expect(win.MyBotParser.readGroupId(win.document)).toBe("1139456570695733");
  });
});
