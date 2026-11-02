import * as cheerio from "cheerio";
import type { IncomingPost } from "./ingest";

export function extractWebBoardPosts(html: string, pageUrl: string): IncomingPost[] {
  const $ = cheerio.load(html);
  const posts: IncomingPost[] = [];
  const seen = new Set<string>();

  const push = (href: string | undefined, text: string, author = "") => {
    if (!href) return;
    let url = "";
    try {
      url = new URL(href, pageUrl).href;
    } catch {
      return;
    }
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length < 20 || seen.has(url)) return;
    if (/^javascript:/i.test(url) || url.startsWith("mailto:")) return;
    seen.add(url);
    posts.push({ url, text: clean.slice(0, 1500), authorName: author, images: [] });
  };

  $("article, .post, .thread, .topic, li.row, .list-item").each((_, element) => {
    const node = $(element);
    const link = node.find("a[href]").first();
    push(link.attr("href"), node.text(), node.find(".author, .username").first().text());
  });

  if (!posts.length) {
    $("main a[href], #content a[href], .content a[href]").each((_, element) => {
      const link = $(element);
      push(link.attr("href"), link.text());
    });
  }

  return posts.slice(0, 30);
}

export async function fetchWebBoardPosts(url: string): Promise<IncomingPost[]> {
  const response = await fetch(url, {
    headers: { "user-agent": "MY-BOT/1.0 (+local lead radar)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`เว็บตอบ ${response.status}`);
  const html = await response.text();
  return extractWebBoardPosts(html, url);
}
