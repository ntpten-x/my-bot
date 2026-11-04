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

  const SEE_MORE = /^(?:ดูเพิ่มเติม|See more|See More|ดูเพิ่ม)$/;

  // Text of a node without inline "See more" toggles. Never clicks: only the text already on the page is read.
  function textWithoutSeeMore(node) {
    const toggles = (SELECTORS.seeMore || []).join(",");
    if (!toggles || !node.cloneNode) return clean(node.textContent);
    const copy = node.cloneNode(true);
    copy.querySelectorAll(toggles).forEach((toggle) => {
      if (SEE_MORE.test(clean(toggle.textContent))) toggle.textContent = "…";
    });
    return clean(copy.textContent)
      .replace(/(?:…\s*)+$/, "…")
      .replace(/\s*(?:…|\.{3})\s*(?:ดูเพิ่มเติม|See more)\s*$/i, "…");
  }

  function extractText(article) {
    for (const selector of SELECTORS.text) {
      const chunks = [];
      article.querySelectorAll(selector).forEach((node) => {
        const value = textWithoutSeeMore(node);
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

  // ---------- Marketplace (read-only listing cards) ----------
  const PRICE = /(?:฿|THB|บาท|ราคา|ฟรี|Free\b|\$|US\$)/i;
  const PRICE_ONLY = /^(?:฿\s?[\d,.]+(?:\s?[KkMm])?|[\d,.]+\s?(?:บาท|THB)|THB\s?[\d,.]+|US?\$\s?[\d,.]+|ฟรี|Free)$/i;

  function leafTexts(node) {
    const texts = [];
    const walk = (element) => {
      const kids = Array.from(element.children || []);
      if (!kids.length || kids.every((kid) => /^(BR|WBR)$/i.test(kid.tagName))) {
        const value = clean(element.textContent);
        if (value && texts.indexOf(value) === -1) texts.push(value);
        return;
      }
      kids.forEach(walk);
    };
    walk(node);
    return texts;
  }

  function listingId(href) {
    const match = String(href || "").match(/\/marketplace\/item\/(\d+)/);
    return match ? match[1] : "";
  }

  function parseMarketplaceListings(doc) {
    const rootDoc = doc || (typeof document !== "undefined" ? document : null);
    const mp = SELECTORS && SELECTORS.marketplace;
    if (!rootDoc || !rootDoc.querySelectorAll || !mp) return [];
    const listings = [];
    const seen = new Set();
    rootDoc.querySelectorAll(mp.card.join(",")).forEach((card) => {
      const id = listingId(card.getAttribute("href"));
      if (!id || seen.has(id)) return;
      const texts = leafTexts(card).filter((value) => value.length <= 200);
      const prices = texts.filter((value) => PRICE_ONLY.test(value) || (PRICE.test(value) && /\d/.test(value) && value.length <= 24));
      const rest = texts.filter((value) => prices.indexOf(value) === -1 && !/^(?:·|•|-)$/.test(value));
      const title = rest[0] || card.getAttribute("aria-label") || "";
      if (!title) return;
      seen.add(id);
      const location = rest[1] || "";
      const price = prices[0] || "";
      let image = "";
      card.querySelectorAll(mp.image.join(",")).forEach((img) => {
        const src = img.getAttribute("src") || "";
        if (!image && /^https?:/i.test(src) && !/emoji|rsrc\.php|static\.xx/.test(src)) image = src;
      });
      const parts = ["ขาย " + title];
      if (price) parts.push("ราคา " + price);
      if (location) parts.push("· " + location);
      listings.push({
        url: "https://www.facebook.com/marketplace/item/" + id + "/",
        authorName: "",
        text: parts.join(" "),
        postedAt: null,
        images: image ? [image] : [],
        kind: "marketplace",
        title,
        price,
        location,
      });
    });
    return listings;
  }

  const api = { parseFacebookPosts, parseMarketplaceListings, SELECTORS };
  root.MyBotParser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
