// Synthetic parser benchmark in isolated Chromium. No extension pairing, tokens or Facebook access.
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  executablePath: chromium.executablePath(),
});
try {
  const context = await browser.newContext();
  await context.route("**/*", route => route.abort());
  const page = await context.newPage();
  await page.setContent("<main>" + Array.from({ length: 100 }, (_, i) =>
    `<div role="article"><h2><a href="/groups/123/user/456">Synthetic Owner</a></h2><a href="/groups/123/posts/${10000 + i}/">Post</a><div data-ad-preview="message" dir="auto">ตามหาช่างซ่อมบ้าน synthetic ${i}</div></div>`,
  ).join("") + "</main>");
  for (const file of ["selectors.js", "fbtime.js", "parser.js"]) {
    await page.addScriptTag({ content: readFileSync(new URL(`../extension/${file}`, import.meta.url), "utf8") });
  }
  const result = await page.evaluate(() => {
    const parser = globalThis.MyBotParser;
    const articles = parser.collectArticles(document);
    const measure = nodes => {
      const start = performance.now();
      let posts;
      // Average 100 calls so a fast one-article parse is not reported as zero by timer rounding.
      for (let i = 0; i < 100; i++) posts = parser.parseFacebookPosts(document, nodes);
      return { ms: (performance.now() - start) / 100, count: posts.length };
    };
    for (let i = 0; i < 5; i++) { measure(articles); measure([articles[0]]); }
    const full = Array.from({ length: 21 }, () => measure(articles));
    const dirty = Array.from({ length: 21 }, () => measure([articles[0]]));
    const median = rows => rows.map(row => row.ms).sort((a, b) => a - b)[10];
    return {
      synthetic: true, sandbox: true, network: "blocked", renderedArticles: articles.length,
      fullMedianMs: median(full), dirtyMedianMs: median(dirty), fullPosts: full[0].count, dirtyPosts: dirty[0].count,
    };
  });
  console.log(JSON.stringify({ browser: browser.version(), ...result }, null, 2));
} finally {
  await browser.close();
}
