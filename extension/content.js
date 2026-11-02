function mybotGroupUrl() {
  const match = location.pathname.match(/\/groups\/([^/?#]+)/);
  if (!match) return null;
  return `https://www.facebook.com/groups/${match[1]}`;
}

function mybotScrape() {
  if (!globalThis.MyBotParser) return;
  const posts = globalThis.MyBotParser.parseFacebookPosts(document);
  const sourceUrl = mybotGroupUrl();
  if (!sourceUrl || !posts.length) return;
  chrome.runtime.sendMessage({ type: "manual-posts", sourceUrl, posts });
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
