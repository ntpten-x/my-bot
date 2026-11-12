// Read only: observe posts Facebook has rendered. No clicks or private APIs.
(function () {
  const seen = new Map(), pending = new Map(), dirty = new Set();
  const SLICE_SIZE = 12, PENDING_MAX = 300, PENDING_TOTAL_MAX = 1200;
  let timer, fallback, busy = false, stopped = false, managedUntil = 0, scope = "", fullScan = true;
  let binding = null, bindingRevision = 0;
  let loadingBinding = false;
  const changedBindingKeys = new Set();
  const local = { apiBase: "https://my-bot-e6bt.onrender.com", token: "", fbIdentity: null };
  const bindingKey = value => JSON.stringify([value.apiBase, value.fbUserId]);
  function updateBinding() {
    const next = { apiBase: String(local.apiBase || "").replace(/\/$/, ""),
      fbUserId: local.fbIdentity?.loggedIn ? String(local.fbIdentity.id || "") : "" };
    if (!binding || bindingKey(binding) !== bindingKey(next)) { fullScan = true; dirty.clear(); managedUntil = 0; bindingRevision++; }
    binding = next;
  }
  async function loadBinding() {
    if (loadingBinding) return;
    loadingBinding = true;
    try {
      const value = await chrome.storage.local.get({ ...local });
      for (const key of Object.keys(local)) if (!changedBindingKeys.has(key)) local[key] = value[key];
      updateBinding(); schedule(100);
    } catch { schedule(2000); }
    finally { loadingBinding = false; }
  }
  void loadBinding();
  function sourceUrl() {
    if (/^\/marketplace(\/|$)/.test(location.pathname) && !/^\/marketplace\/item\//.test(location.pathname)) return location.href.split("#")[0];
    const group = location.pathname.match(/\/groups\/([^/?#]+)/);
    return group ? `https://www.facebook.com/groups/${group[1]}` : null;
  }
  function schedule(delay = 500) {
    if (!stopped && document.visibilityState !== "hidden" && !timer) timer = setTimeout(() => { timer = null; void capture(); }, delay);
  }
  const marketplace = () => /^\/marketplace\//.test(location.pathname);
  function collect(root) {
    if (marketplace()) return globalThis.MyBotParser.collectMarketplaceCards(root);
    const own = root.matches?.('article,[role="article"],[aria-posinset]') ? [root] : [];
    return [...own, ...globalThis.MyBotParser.collectArticles(root)];
  }
  function closestArticle(node) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (marketplace()) return element?.closest('a[href*="/marketplace/item/"]');
    const article = element?.closest('article,[role="article"],[aria-posinset]');
    const fallback = globalThis.MyBotParser?.SELECTORS?.article?.join(",");
    return article || (fallback ? element?.closest(fallback) : null);
  }
  function message(body) {
    return new Promise(resolve => {
      const timeout = setTimeout(() => resolve(null), 5000);
      try {
        chrome.runtime.sendMessage(body, result => { void chrome.runtime.lastError; clearTimeout(timeout); resolve(result); });
      } catch { clearTimeout(timeout); resolve(null); }
    });
  }
  async function capture() {
    if (stopped || document.visibilityState === "hidden" || !globalThis.MyBotParser || !globalThis.MyBotScrape) return;
    if (!binding) { void loadBinding(); return; }
    if (!local.token || !binding.fbUserId) return;
    const source = sourceUrl();
    if (!source || busy) return;
    if (scope !== source) { scope = source; fullScan = true; dirty.clear(); managedUntil = 0; }
    if (Date.now() < managedUntil) return;
    busy = true;
    let accepted = false;
    const capturedBinding = { ...binding }, revision = bindingRevision;
    const contextKey = bindingKey(capturedBinding);
    let contextPending = [...pending.values()].filter(row => row.contextKey === contextKey).length;
    const hasRoom = () => contextPending < PENDING_MAX && pending.size < PENDING_TOTAL_MAX;
    try {
      if (fullScan) { for (const article of collect(document)) dirty.add(article); fullScan = false; }
      const candidates = [];
      for (const article of dirty) {
        if (candidates.length >= SLICE_SIZE || !hasRoom()) break;
        dirty.delete(article);
        if (article.isConnected) candidates.push(article);
      }
      if (candidates.length) {
        const posts = marketplace() ? globalThis.MyBotParser.parseMarketplaceListings(document, candidates)
          : globalThis.MyBotParser.parseFacebookPosts(document, candidates);
        for (const post of posts) {
          const postKey = globalThis.MyBotScrape.postKey(post.url);
          if (!postKey) continue;
          const key = JSON.stringify([contextKey, source, postKey]);
          const fingerprint = JSON.stringify([post.text, Boolean(post.truncated), post.images || []]);
          if (seen.get(key) === fingerprint) continue;
          if (!pending.has(key) && !hasRoom()) { for (const article of candidates) dirty.add(article); break; }
          const previous = pending.get(key);
          if (!previous) contextPending++;
          pending.set(key, { source, contextKey, captureScope: capturedBinding, fingerprint,
            post: { ...post, observedAt: previous?.fingerprint === fingerprint ? previous.post.observedAt : Date.now() } });
        }
      }
      const eligible = [...pending.entries()].filter(([, row]) => row.contextKey === contextKey);
      const batchSource = eligible[0]?.[1].source;
      const batch = eligible.filter(([, row]) => row.source === batchSource).slice(0, 40);
      // Finish short discovery slices before sending a partially filled transport batch.
      if (!batch.length || (batch.length < 40 && dirty.size && hasRoom())) return;
      const result = await message({ type: "manual-posts", sourceUrl: batchSource, captureScope: capturedBinding, posts: batch.map(([, row]) => row.post) });
      if (result?.ok && result.accepted === true) {
        accepted = true;
        for (const [key, row] of batch) {
          seen.delete(key); seen.set(key, row.fingerprint);
          if (pending.get(key) === row) pending.delete(key);
        }
        while (seen.size > 1000) seen.delete(seen.keys().next().value);
      } else if (revision === bindingRevision && (result?.managedReader || result?.retryAfterMs > 0)) {
        managedUntil = Date.now() + Math.min(15000, result.retryAfterMs || 15000);
      }
    } catch { /* Never remove pending posts until durable acknowledgement. */ }
    finally {
      busy = false;
      const eligiblePending = [...pending.values()].some(row => binding && row.contextKey === bindingKey(binding));
      const currentCount = [...pending.values()].filter(row => binding && row.contextKey === bindingKey(binding)).length;
      if (Date.now() >= managedUntil && (dirty.size || fullScan || eligiblePending)) schedule(dirty.size && currentCount < PENDING_MAX && pending.size < PENDING_TOTAL_MAX ? 16 : accepted ? 100 : 2000);
    }
  }
  const relevant = "main,[role=main],[role=feed],[role=article]";
  const observer = new MutationObserver(records => {
    let changed = false;
    for (const record of records) {
      const article = closestArticle(record.target);
      if (article) { dirty.add(article); changed = true; }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const owner = closestArticle(node);
        if (owner) { dirty.add(owner); changed = true; }
        else if (globalThis.MyBotParser) for (const candidate of collect(node)) { dirty.add(candidate); changed = true; }
      }
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target?.closest(relevant)) changed = true;
    }
    for (const article of dirty) if (!article.isConnected) dirty.delete(article);
    if (changed) schedule();
  });
  const observe = () => observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href", "datetime", "data-utime"] });
  function resume() {
    if (stopped || document.visibilityState === "hidden") return;
    fullScan = true; observe();
    if (!fallback) fallback = setInterval(() => { fullScan = true; schedule(100); }, 15000);
    schedule(100);
  }
  function suspend() {
    observer.disconnect(); clearTimeout(timer); timer = null; clearInterval(fallback); fallback = null;
  }
  if (document.visibilityState !== "hidden") { observe(); fallback = setInterval(() => { fullScan = true; schedule(100); }, 15000); }
  window.addEventListener("scroll", () => schedule(), { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") suspend(); else resume(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key of ["apiBase", "token", "fbIdentity"]) if (changes[key]) { changedBindingKeys.add(key); local[key] = changes[key].newValue; }
    const identityChanged = changes.fbIdentity && ["id", "loggedIn"].some(key => changes.fbIdentity.oldValue?.[key] !== changes.fbIdentity.newValue?.[key]);
    const controlChanged = changes.serverAccountControl && ["paused", "apiBase", "fbUserId"].some(key => changes.serverAccountControl.oldValue?.[key] !== changes.serverAccountControl.newValue?.[key]);
    if (identityChanged || controlChanged || ["token", "apiBase", "paused"].some(key => changes[key] && changes[key].oldValue !== changes[key].newValue)) {
      updateBinding(); managedUntil = 0; schedule(100);
    }
  });
  window.addEventListener("pagehide", () => { stopped = true; suspend(); });
  window.addEventListener("pageshow", event => { if (event.persisted) { stopped = false; resume(); } });
  schedule(1000);
})();
