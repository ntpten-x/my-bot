// Read-only: parses what is already on screen and hands it to the background worker. Never clicks or types.
function mybotGroupUrl() {
  const match = location.pathname.match(/\/groups\/([^/?#]+)/);
  if (!match) return null;
  return `https://www.facebook.com/groups/${match[1]}`;
}

function mybotMarketplaceUrl() {
  if (!/^\/marketplace(\/|$)/.test(location.pathname) || /^\/marketplace\/item\//.test(location.pathname)) return null;
  return location.href.split("#")[0];
}

function mybotScrape() {
  if (!globalThis.MyBotParser) return;
  const marketplaceUrl = mybotMarketplaceUrl();
  const sourceUrl = marketplaceUrl || mybotGroupUrl();
  if (!sourceUrl) return;
  const posts = marketplaceUrl
    ? globalThis.MyBotParser.parseMarketplaceListings(document)
    : globalThis.MyBotParser.parseFacebookPosts(document);
  if (!posts.length) return;
  chrome.runtime.sendMessage({ type: "manual-posts", sourceUrl, posts: posts.slice(0, 40) });
}

let mybotTimer = setTimeout(mybotScrape, 4000);
window.addEventListener(
  "scroll",
  () => {
    clearTimeout(mybotTimer);
    mybotTimer = setTimeout(mybotScrape, 8000);
  },
  { passive: true },
);
