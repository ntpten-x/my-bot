// Read only: observe posts Facebook has rendered. No clicks, reloads or private APIs.
(function () {
  const seen = new Map();
  const pending = new Map();
  let timer, busy = false, managedUntil = 0, epoch = 0, scope = "", stopped = false;
  function sourceUrl() {
    if (/^\/marketplace(\/|$)/.test(location.pathname) && !/^\/marketplace\/item\//.test(location.pathname)) return location.href.split("#")[0];
    const group = location.pathname.match(/\/groups\/([^/?#]+)/);
    return group ? `https://www.facebook.com/groups/${group[1]}` : null;
  }
  function schedule(delay = 500) {
    if (!stopped && !timer) timer = setTimeout(() => { timer = null; void capture(); }, delay);
  }
  async function capture() {
    if (stopped || document.visibilityState === "hidden" || !globalThis.MyBotParser || !globalThis.MyBotScrape) return;
    const source = sourceUrl();
    if (!source) return;
    if (scope !== source) { scope = source; seen.clear(); pending.clear(); epoch++; managedUntil = 0; }
    if (busy || Date.now() < managedUntil) return;
    busy = true;
    const generation = epoch;
    let accepted = false;
    try {
      const posts = /^\/marketplace\//.test(location.pathname)
        ? globalThis.MyBotParser.parseMarketplaceListings(document) : globalThis.MyBotParser.parseFacebookPosts(document);
      for (const post of posts) {
        const key = globalThis.MyBotScrape.postKey(post.url);
        const fingerprint = JSON.stringify([post.text, Boolean(post.truncated), post.images || []]);
        if (!key || seen.get(key) === fingerprint) continue;
        if (!pending.has(key) && pending.size >= 300) break;
        const previous = pending.get(key);
        pending.set(key, { post: { ...post, observedAt: previous?.fingerprint === fingerprint ? previous.post.observedAt : Date.now() }, fingerprint });
      }
      // Parser snapshots and local caches are bounded. Durable transport belongs to the worker.
      const batch = [...pending.entries()].slice(0, 40);
      if (!batch.length) return;
      const result = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "manual-posts", sourceUrl: source, posts: batch.map(([, row]) => row.post) }, response => {
          void chrome.runtime.lastError;
          resolve(response);
        });
      });
      if (generation !== epoch) return;
      if (result?.managedReader) { managedUntil = Date.now() + 15000; return; }
      if (result?.retryAfterMs > 0) { managedUntil = Date.now() + Math.min(15000, result.retryAfterMs); return; }
      if (result?.ok && result.accepted === true) {
        accepted = true;
        for (const [key, row] of batch) {
          seen.delete(key); seen.set(key, row.fingerprint);
          if (pending.get(key)?.fingerprint === row.fingerprint) pending.delete(key);
        }
        while (seen.size > 1000) seen.delete(seen.keys().next().value);
      }
    } catch { /* Keep pending until the worker confirms durable enqueue. */ }
    finally { busy = false; if (pending.size && Date.now() >= managedUntil) schedule(accepted ? 100 : 2000); }
  }
  const relevant = "main,[role=main],[role=feed],[role=article]";
  const observer = new MutationObserver(records => {
    if (records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      return target?.closest(relevant) || [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches(relevant) || node.querySelector(relevant)));
    })) schedule();
  });
  const observe = () => observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href", "datetime", "data-utime"] });
  observe();
  window.addEventListener("scroll", () => schedule(), { passive: true });
  document.addEventListener("visibilitychange", () => schedule(100));
  chrome.storage.onChanged.addListener((changes, area) => {
    const identityChanged = changes.fbIdentity && ["id", "loggedIn"].some(key => changes.fbIdentity.oldValue?.[key] !== changes.fbIdentity.newValue?.[key]);
    const controlChanged = changes.serverAccountControl && ["paused", "apiBase", "fbUserId"].some(key => changes.serverAccountControl.oldValue?.[key] !== changes.serverAccountControl.newValue?.[key]);
    if (area === "local" && (identityChanged || controlChanged || ["token", "apiBase", "paused"].some(key => changes[key] && changes[key].oldValue !== changes[key].newValue))) {
      epoch++; seen.clear(); pending.clear(); managedUntil = 0; schedule(100);
    }
  });
  let fallback = setInterval(() => schedule(100), 15000);
  window.addEventListener("pagehide", () => { stopped = true; epoch++; observer.disconnect(); clearTimeout(timer); timer = null; clearInterval(fallback); });
  window.addEventListener("pageshow", event => { if (event.persisted) { stopped = false; observe(); fallback = setInterval(() => schedule(100), 15000); schedule(100); } });
  schedule(1000);
})();
