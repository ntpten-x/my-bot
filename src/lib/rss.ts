import Parser from "rss-parser";
import type { IncomingPost } from "./ingest";

const parser = new Parser();

export function mapRssItems(
  items: Array<{
    link?: string;
    title?: string;
    contentSnippet?: string;
    content?: string;
    isoDate?: string;
    pubDate?: string;
    creator?: string;
    author?: string;
  }>,
): IncomingPost[] {
  const posts: IncomingPost[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const url = item.link?.trim();
    const text = [item.title, item.contentSnippet || item.content]
      .filter(Boolean)
      .join("\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!url || text.length < 8 || seen.has(url)) continue;
    seen.add(url);
    posts.push({
      url,
      text: text.slice(0, 4000),
      authorName: item.creator || item.author || "",
      postedAt: item.isoDate || item.pubDate || null,
      images: [],
    });
  }
  return posts.slice(0, 30);
}

export async function fetchRssPosts(url: string): Promise<IncomingPost[]> {
  const feed = await parser.parseURL(url);
  return mapRssItems(feed.items ?? []);
}
