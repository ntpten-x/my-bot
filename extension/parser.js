(function (root) {
  const SELECTORS =
    root.MyBotSelectors ||
    (typeof require !== "undefined" ? require("./selectors.js") : null);

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function absUrl(href) {
    if (!href) return "";
    try {
      return new URL(href, "https://www.facebook.com").href.split("#")[0];
    } catch (_error) {
      return "";
    }
  }

  function collectArticles(doc) {
    const found = new Set();
    for (const selector of SELECTORS.article) {
      doc.querySelectorAll(selector).forEach((element) => {
        const article = element.closest('[role="article"]') || element.closest("[aria-posinset]") || element;
        found.add(article);
      });
    }
    return Array.from(found);
  }

  function extractPermalink(article) {
    let fallback = "";
    for (const selector of SELECTORS.permalink) {
      const nodes = article.querySelectorAll(selector);
      for (const node of nodes) {
        const href = absUrl(node.getAttribute("href"));
        if (!href || href.indexOf("facebook.com") === -1) continue;
        if (/\/posts\/|\/permalink\/|story_fbid|multi_permalinks/.test(href)) return href;
        if (!fallback) fallback = href;
      }
    }
    return fallback;
  }

  function extractText(article) {
    for (const selector of SELECTORS.text) {
      const chunks = [];
      article.querySelectorAll(selector).forEach((node) => {
        const value = clean(node.textContent);
        if (value.length >= 8 && chunks.indexOf(value) === -1) chunks.push(value);
      });
      if (chunks.length) {
        chunks.sort((a, b) => b.length - a.length);
        return chunks[0];
      }
    }
    return "";
  }

  function extractAuthor(article) {
    for (const selector of SELECTORS.author) {
      const element = article.querySelector(selector);
      const value = clean(element && element.textContent);
      if (value && value.length < 80 && !/^facebook$/i.test(value)) return value;
    }
    const label = article.getAttribute("aria-label") || "";
    const match = label.match(/(?:โพสต์ของ|Post by)\s+(.+)/i);
    return match ? clean(match[1]) : "";
  }

  function extractTime(article) {
    const time = article.querySelector("time[datetime]");
    if (time && time.getAttribute("datetime")) return time.getAttribute("datetime");
    const abbr = article.querySelector("abbr[data-utime]");
    if (abbr && abbr.getAttribute("data-utime")) {
      const seconds = Number(abbr.getAttribute("data-utime"));
      if (seconds) return new Date(seconds * 1000).toISOString();
    }
    return null;
  }

  function extractImages(article) {
    const images = [];
    article.querySelectorAll(SELECTORS.image.join(",")).forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (!/^https?:/i.test(src)) return;
      if (/emoji|rsrc\.php|static\.xx/.test(src)) return;
      if (images.indexOf(src) === -1) images.push(src);
    });
    return images.slice(0, 6);
  }

  function parseFacebookPosts(doc) {
    const rootDoc = doc || (typeof document !== "undefined" ? document : null);
    if (!rootDoc || !rootDoc.querySelectorAll || !SELECTORS) return [];
    const posts = [];
    const seen = new Set();
    for (const article of collectArticles(rootDoc)) {
      const text = extractText(article);
      const url = extractPermalink(article);
      if (!text || text.length < 8 || !url) continue;
      const key = url.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      posts.push({
        url,
        authorName: extractAuthor(article),
        text,
        postedAt: extractTime(article),
        images: extractImages(article),
      });
    }
    return posts;
  }

  const api = { parseFacebookPosts, SELECTORS };
  root.MyBotParser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
