importScripts("assist.js", "identity.js", "scrape.js");

const DEFAULTS = {
  apiBase: "http://localhost:8001",
  token: "",
  enabled: false,
  schedules: {},
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Only the local app over http, or any server over HTTPS, ever receives the token.
function validApiBase(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

async function loadConfig() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const cfg = { ...DEFAULTS, ...stored, schedules: stored.schedules || {} };
  if (!validApiBase(cfg.apiBase)) return { ...cfg, apiBase: DEFAULTS.apiBase, token: "" };
  return cfg;
}

// The MY-BOT page bridge for a custom HTTPS server the owner granted in the popup (*.onrender.com is in the manifest).
const CUSTOM_BRIDGE_ID = "mybot-bridge-custom";
async function syncCustomBridge() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CUSTOM_BRIDGE_ID] });
  } catch {
    // not registered yet
  }
  const cfg = await loadConfig();
  let url;
  try {
    url = new URL(base(cfg));
  } catch {
    return;
  }
  if (url.protocol !== "https:" || /\.onrender\.com$/i.test(url.hostname)) return;
  const pattern = `${url.origin}/*`;
  if (!(await chrome.permissions.contains({ origins: [pattern] }))) return;
  await chrome.scripting
    .registerContentScripts([{ id: CUSTOM_BRIDGE_ID, matches: [pattern], js: ["bridge.js"], runAt: "document_start" }])
    .catch(() => undefined);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.apiBase) void syncCustomBridge();
});
chrome.permissions.onAdded.addListener(() => void syncCustomBridge());

function headers(token) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function base(cfg) {
  return String(cfg.apiBase || DEFAULTS.apiBase).replace(/\/$/, "");
}

function sourceKind(group) {
  if (group && (group.kind === "marketplace" || group.type === "facebook_marketplace")) return "marketplace";
  try {
    return /^\/marketplace(\/|$)/.test(new URL(group.url).pathname) ? "marketplace" : "group";
  } catch {
    return "group";
  }
}

function waitComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("แท็บกลุ่มโหลดไม่ทัน"));
    }, 25000);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Network calls never hang: each try has a timeout, and a sleeping/restarting server gets retried with backoff.
const RETRY_STATUS = new Set([408, 429, 502, 503, 504]);
async function fetchRetry(url, options = {}, { timeoutMs = 45000, retries = 2 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!RETRY_STATUS.has(response.status) || attempt === retries) return response;
      lastError = new Error(`MY-BOT ตอบกลับ ${response.status}`);
    } catch (error) {
      lastError = error && error.name === "AbortError" ? new Error("MY-BOT ไม่ตอบภายในเวลาที่กำหนด") : error;
      if (attempt === retries) throw lastError;
    } finally {
      clearTimeout(timer);
    }
    await sleep(2000 * 3 ** attempt + Math.random() * 1000);
  }
  throw lastError || new Error("ติดต่อ MY-BOT ไม่ได้");
}

async function postJson(cfg, path, body, opts) {
  return fetchRetry(`${base(cfg)}${path}`, {
    method: "POST",
    headers: headers(cfg.token),
    body: JSON.stringify(body),
  }, opts);
}

async function getJson(cfg, path, opts = { timeoutMs: 30000, retries: 1 }) {
  return fetchRetry(`${base(cfg)}${path}`, { headers: headers(cfg.token) }, opts);
}

// ---- Status for the "ภาพรวมระบบ" page (read-only facts about this browser) ----
async function installId() {
  const stored = await chrome.storage.local.get({ installId: "" });
  if (stored.installId) return stored.installId;
  const id = (crypto.randomUUID ? crypto.randomUUID() : `ext-${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64);
  await chrome.storage.local.set({ installId: id });
  return id;
}

// Error log for the overview page: last 20 distinct messages (repeats counted) and hourly counts for 24 h.
async function rememberError(message) {
  const text = String(message || "").slice(0, 300);
  const now = Date.now();
  const stored = await chrome.storage.local.get({ errorLog: [], errorHours: {} });
  const log = Array.isArray(stored.errorLog) ? stored.errorLog : [];
  const same = log.findIndex((entry) => entry.message === text);
  if (same >= 0) {
    const [entry] = log.splice(same, 1);
    log.unshift({ message: text, at: now, count: (entry.count || 1) + 1 });
  } else log.unshift({ message: text, at: now, count: 1 });
  const hours = {};
  const hour = Math.floor(now / 3600000);
  for (const [key, count] of Object.entries(stored.errorHours || {})) if (hour - Number(key) < 24) hours[key] = count;
  hours[hour] = (hours[hour] || 0) + 1;
  await chrome.storage.local.set({ lastError: { message: text, at: now }, errorLog: log.slice(0, 20), errorHours: hours });
}

async function errorSummary() {
  const stored = await chrome.storage.local.get({ errorLog: [], errorHours: {} });
  const hour = Math.floor(Date.now() / 3600000);
  const count24h = Object.entries(stored.errorHours || {}).reduce((sum, [key, count]) => (hour - Number(key) < 24 ? sum + (Number(count) || 0) : sum), 0);
  const log = (Array.isArray(stored.errorLog) ? stored.errorLog : []).slice(0, 20).map((entry) => ({ at: Number(entry.at) || 0, message: String(entry.message || "").slice(0, 300), count: Math.max(1, Number(entry.count) || 1) }));
  return { count24h, log };
}

// ---- Outbox: posts that could not reach MY-BOT wait here (chrome.storage) and are re-sent later ----
const OUTBOX_MAX = 200;
const OUTBOX_MAX_AGE_MS = 72 * 3600000;
async function loadOutbox() {
  const stored = await chrome.storage.local.get({ outbox: [] });
  const now = Date.now();
  return (Array.isArray(stored.outbox) ? stored.outbox : []).filter((item) => item && now - (item.at || 0) < OUTBOX_MAX_AGE_MS);
}

async function queueOutbox(item) {
  const outbox = await loadOutbox();
  outbox.push({ ...item, at: Date.now() });
  await chrome.storage.local.set({ outbox: outbox.slice(-OUTBOX_MAX) });
}

let flushing = false;
async function flushOutbox(cfg) {
  if (flushing || !cfg.token) return;
  flushing = true;
  try {
    let outbox = await loadOutbox();
    for (let sent = 0; outbox.length && sent < 10; sent += 1) {
      const item = outbox[0];
      const response = await postJson(cfg, "/api/v1/ingest", { sourceUrl: item.sourceUrl, posts: item.posts, fbUserId: item.fbUserId || undefined }, { timeoutMs: 45000, retries: 0 }).catch(() => null);
      if (!response || RETRY_STATUS.has(response.status) || response.status >= 500) break;
      // Sent, or rejected for good (4xx): either way it leaves the outbox.
      if (response.ok) await countSent(item.posts.length);
      outbox = (await loadOutbox()).filter((entry) => !(entry.at === item.at && entry.sourceUrl === item.sourceUrl));
      await chrome.storage.local.set({ outbox });
    }
    if (!outbox.length) await chrome.storage.local.set({ outbox: [] });
  } finally {
    flushing = false;
  }
}

async function countSent(count) {
  if (count) await chrome.storage.local.set({ lastPostAt: Date.now() });
  const stored = await chrome.storage.local.get({ postsSent: 0 });
  await chrome.storage.local.set({ postsSent: (stored.postsSent || 0) + count });
}

async function rememberIdentity(identity) {
  if (!identity || typeof identity !== "object") return;
  const loggedIn = Boolean(identity.loggedIn);
  const id = loggedIn && /^\d{5,20}$/.test(String(identity.id || "")) ? String(identity.id) : "";
  const stored = await chrome.storage.local.get({ fbIdentity: null });
  const previous = stored.fbIdentity || {};
  const name = String(identity.name || "").slice(0, 80) || (previous.id === id ? previous.name || "" : "");
  await chrome.storage.local.set({ fbIdentity: { loggedIn: Boolean(id), id, name, at: Date.now() } });
}

async function currentFbUserId() {
  const stored = await chrome.storage.local.get({ fbIdentity: null });
  return stored.fbIdentity && stored.fbIdentity.loggedIn ? stored.fbIdentity.id : "";
}

async function sendPosts(cfg, sourceUrl, posts) {
  if (!posts.length) return null;
  const fbUserId = await currentFbUserId();
  let response = null;
  try {
    response = await postJson(cfg, "/api/v1/ingest", { sourceUrl, posts, fbUserId: fbUserId || undefined });
  } catch (error) {
    await queueOutbox({ sourceUrl, posts, fbUserId });
    await rememberError(`ส่งโพสต์ไม่สำเร็จ เก็บไว้ส่งใหม่ ${posts.length} โพสต์: ${String(error && error.message ? error.message : error).slice(0, 120)}`);
    return null;
  }
  if (response.ok) {
    await countSent(posts.length);
  } else {
    if (response.status >= 500 || RETRY_STATUS.has(response.status)) await queueOutbox({ sourceUrl, posts, fbUserId });
    const data = await response.clone().json().catch(() => ({}));
    await rememberError(`ส่งโพสต์เข้า MY-BOT ไม่สำเร็จ (${response.status}) ${data.error || ""}`.trim());
  }
  return response;
}

function browserName() {
  const ua = (self.navigator && self.navigator.userAgent) || "";
  const edge = ua.match(/Edg\/(\d+)/);
  if (edge) return `Edge ${edge[1]}`;
  const opera = ua.match(/OPR\/(\d+)/);
  if (opera) return `Opera ${opera[1]}`;
  const chrome = ua.match(/Chrome\/(\d+)/);
  return chrome ? `Chrome ${chrome[1]}` : "Browser";
}

async function readingTabs() {
  const tabs = await chrome.tabs
    .query({
      url: [
        "https://www.facebook.com/groups/*",
        "https://facebook.com/groups/*",
        "https://web.facebook.com/groups/*",
        "https://www.facebook.com/marketplace/*",
        "https://facebook.com/marketplace/*",
        "https://web.facebook.com/marketplace/*",
      ],
    })
    .catch(() => []);
  return tabs.slice(0, 15).map((tab) => ({ title: String(tab.title || "").slice(0, 120), url: String(tab.url || "").split("?")[0].slice(0, 200) }));
}

let beating = false;

async function heartbeat() {
  if (beating) return;
  const cfg = await loadConfig();
  if (!cfg.token) return;
  beating = true;
  try {
    const stored = await chrome.storage.local.get({ fbIdentity: null, lastError: null, lastPostAt: 0, postsSent: 0, profileLabel: "" });
    const outbox = await loadOutbox();
    const fb = stored.fbIdentity || { loggedIn: false, id: "", name: "", at: 0 };
    const response = await postJson(cfg, "/api/v1/extension/heartbeat", {
      installId: await installId(),
      version: chrome.runtime.getManifest().version,
      browser: browserName(),
      profileLabel: String(stored.profileLabel || "").slice(0, 60),
      enabled: Boolean(cfg.enabled),
      fb: { loggedIn: Boolean(fb.loggedIn), id: fb.id || "", name: fb.name || "", checkedAt: fb.at || 0 },
      tabs: await readingTabs(),
      lastError: stored.lastError || null,
      lastPostAt: stored.lastPostAt || 0,
      postsSent: stored.postsSent || 0,
      errors: await errorSummary(),
      outboxSize: outbox.length,
    }, { timeoutMs: 30000, retries: 1 });
    await chrome.storage.local.set({ lastHeartbeat: { at: Date.now(), status: response.status } });
    if (response.ok && outbox.length) await flushOutbox(cfg);
  } catch {
    await chrome.storage.local.set({ lastHeartbeat: { at: Date.now(), status: 0 } });
  } finally {
    beating = false;
  }
}

// ---- Read-only scroll scrape ----
// One background tab at a time (the shared `cycling` lock). Scrolls the page with scrollTop only:
// no clicks, no key presses, no form actions, no Facebook APIs. "See more" text is read as-is, never expanded.
const scrapingTabs = new Set();

async function readPage(tabId, kind) {
  const [executed] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [kind],
    func: (pageKind) => ({
      posts:
        pageKind === "marketplace"
          ? globalThis.MyBotParser.parseMarketplaceListings(document)
          : globalThis.MyBotParser.parseFacebookPosts(document),
      identity: globalThis.MyBotIdentity ? globalThis.MyBotIdentity.readFacebookIdentity(document) : null,
      groupId: pageKind === "marketplace" || !globalThis.MyBotParser.readGroupId ? "" : globalThis.MyBotParser.readGroupId(document),
    }),
  });
  return executed && executed.result ? executed.result : { posts: [], identity: null, groupId: "" };
}

async function scrollOneScreen(tabId) {
  const [executed] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const page = document.scrollingElement || document.documentElement;
      const before = page.scrollTop;
      page.scrollTop = before + Math.max(window.innerHeight || 0, 800);
      return { moved: page.scrollTop - before, height: page.scrollHeight };
    },
  });
  return executed && executed.result ? executed.result : { moved: 0, height: 0 };
}

async function scrapeSettingsFor(remote) {
  if (remote) {
    const picked = { scrollScreens: remote.scrollScreens, maxAgeHours: remote.maxAgeHours, maxPostsPerRun: remote.maxPostsPerRun };
    await chrome.storage.local.set({ scrapeSettings: picked });
    return globalThis.MyBotScrape.scrapeSettings(picked);
  }
  const stored = await chrome.storage.local.get({ scrapeSettings: null });
  return globalThis.MyBotScrape.scrapeSettings(stored.scrapeSettings);
}

async function reportRun(cfg, group, run) {
  try {
    const response = await postJson(cfg, "/api/v1/extension/scrape-result", {
      sourceUrl: group.url,
      groupId: run.groupId || undefined,
      ok: run.ok,
      postsFound: run.postsFound,
      newPosts: run.newPosts,
      scrolls: run.scrolls,
      stoppedBy: run.ok ? run.stoppedBy || "end" : "error",
      mode: run.mode,
      coverage: run.stats || undefined,
      message: run.ok ? undefined : run.message,
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({}));
    const next = Date.parse(data.nextRunAt || "");
    return Number.isFinite(next) ? next : null;
  } catch {
    return null;
  }
}

const MAX_FULL_TEXT_PER_RUN = 3;

function postKey(url) {
  return String(url || "").split("?")[0].replace(/\/+$/, "");
}

// Posts cut off at "See more": open each permalink in the same background tab and read the text
// Facebook shows there. Navigation and reading only; nothing on the page is clicked.
async function readFullTexts(tabId, kind, urls) {
  const found = [];
  for (const url of urls.slice(0, MAX_FULL_TEXT_PER_RUN)) {
    try {
      await chrome.tabs.update(tabId, { url });
      await waitComplete(tabId);
      await sleep(2500);
      await chrome.scripting.executeScript({ target: { tabId }, files: ["selectors.js", "fbtime.js", "parser.js", "identity.js"] });
      const page = await readPage(tabId, kind);
      const posts = (page.posts || []).filter((post) => !post.truncated);
      const match = posts.find((post) => postKey(post.url) === postKey(url)) || posts.sort((a, b) => b.text.length - a.text.length)[0];
      if (match) found.push({ ...match, url });
    } catch {
      // Skip this one; it is tried again on a later run.
    }
  }
  return found;
}

// Wait (read-only) until the feed shows more posts or grows, using a MutationObserver in the page.
async function waitForGrowth(tabId, kind, before, timeoutMs) {
  const [executed] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [kind, before || 0, timeoutMs],
    func: (pageKind, prev, limit) =>
      new Promise((resolve) => {
        const selector = pageKind === "marketplace" ? 'a[href*="/marketplace/item/"]' : '[role="article"], [aria-posinset]';
        const count = () => document.querySelectorAll(selector).length;
        const page = document.scrollingElement || document.documentElement;
        const startHeight = page.scrollHeight;
        let done = false;
        const finish = (grew) => {
          if (done) return;
          done = true;
          observer.disconnect();
          resolve({ count: count(), grew, height: page.scrollHeight });
        };
        const check = () => {
          if (count() > prev || page.scrollHeight > startHeight + 200) setTimeout(() => finish(true), 700);
        };
        const observer = new MutationObserver(check);
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        check();
        setTimeout(() => finish(false), limit);
      }),
  });
  return executed && executed.result ? executed.result : { count: 0, grew: false, height: 0 };
}

// Lazy loading stalled: scroll up a little and back to the bottom so the feed asks for more (scrollTop only).
async function nudgeScroll(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const page = document.scrollingElement || document.documentElement;
      page.scrollTop = Math.max(0, page.scrollTop - 900);
      setTimeout(() => {
        page.scrollTop = page.scrollHeight;
      }, 600);
      return true;
    },
  });
}

async function injectReaders(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["selectors.js", "fbtime.js", "parser.js", "identity.js"] });
}

// A background tab by default; a small unfocused window when background tabs do not render the feed.
// Readers are remembered in session storage so a service-worker restart can close the ones it left open.
const BOOT_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const READER_MAX_AGE_MS = 15 * 60 * 1000;
async function trackReader(reader, add) {
  const stored = await chrome.storage.session.get({ readers: {} });
  const readers = stored.readers || {};
  const key = String(reader.windowId !== undefined ? `w${reader.windowId}` : `t${reader.tabId}`);
  if (add) readers[key] = { tabId: reader.tabId, windowId: reader.windowId, boot: BOOT_ID, at: Date.now() };
  else delete readers[key];
  await chrome.storage.session.set({ readers });
}

async function closeOrphanReaders() {
  const stored = await chrome.storage.session.get({ readers: {} });
  const readers = stored.readers || {};
  let changed = false;
  for (const [key, reader] of Object.entries(readers)) {
    const orphan = reader.boot !== BOOT_ID || (!cycling && Date.now() - (reader.at || 0) > READER_MAX_AGE_MS);
    if (!orphan) continue;
    if (reader.windowId !== undefined && reader.windowId !== null) await chrome.windows.remove(reader.windowId).catch(() => undefined);
    else if (reader.tabId !== undefined && reader.tabId !== null) await chrome.tabs.remove(reader.tabId).catch(() => undefined);
    scrapingTabs.delete(reader.tabId);
    delete readers[key];
    changed = true;
  }
  if (changed) await chrome.storage.session.set({ readers });
}

async function openReader(url, useWindow) {
  let reader;
  if (useWindow) {
    const win = await chrome.windows.create({ url, focused: false, state: "normal", width: 560, height: 900, left: 0, top: 0 });
    const tab = win.tabs && win.tabs[0];
    reader = { tabId: tab ? tab.id : undefined, windowId: win.id };
  } else {
    const tab = await chrome.tabs.create({ url, active: false });
    reader = { tabId: tab.id, windowId: undefined };
  }
  await trackReader(reader, true).catch(() => undefined);
  return reader;
}

async function closeReader(reader) {
  if (!reader) return;
  if (reader.windowId !== undefined) await chrome.windows.remove(reader.windowId).catch(() => undefined);
  else if (reader.tabId !== undefined) await chrome.tabs.remove(reader.tabId).catch(() => undefined);
  scrapingTabs.delete(reader.tabId);
  await trackReader(reader, false).catch(() => undefined);
}

// Scroll and read one feed until the stop rule fires. Returns the run (see scrape.js).
async function readFeed(reader, kind, plan, knownKeys, result) {
  const Scrape = globalThis.MyBotScrape;
  const tabId = reader.tabId;
  const run = Scrape.createRun({ knownKeys, ...plan });
  await waitComplete(tabId).catch(() => undefined);
  await injectReaders(tabId);
  let state = await waitForGrowth(tabId, kind, 0, 12000);
  if (!state.count) {
    run.stalls += 1;
    await sleep(3000);
    state = await waitForGrowth(tabId, kind, 0, 8000);
  }
  const first = await readPage(tabId, kind);
  if (first.identity) await rememberIdentity(first.identity);
  if (first.groupId) result.groupId = first.groupId;
  result.sample = (first.posts || []).slice(0, 8);
  let stop = Scrape.addStep(run, first.posts);
  while (!stop) {
    const before = state.count;
    await scrollOneScreen(tabId);
    await sleep(Scrape.scrollWaitMs());
    state = await waitForGrowth(tabId, kind, before, 6000);
    for (let retry = 0; !state.grew && retry < 2; retry += 1) {
      run.stalls += 1;
      await nudgeScroll(tabId);
      state = await waitForGrowth(tabId, kind, before, 7000);
    }
    const page = await readPage(tabId, kind);
    stop = Scrape.addStep(run, page.posts);
  }
  return run;
}

function cleanPost(post) {
  const Scrape = globalThis.MyBotScrape;
  return { url: post.url, authorName: post.authorName || "", text: Scrape.cleanupText(post.text), postedAt: post.postedAt || null, images: post.images || [] };
}

async function scrapeGroup(cfg, group, remote, options) {
  const Scrape = globalThis.MyBotScrape;
  const kind = sourceKind(group);
  const settings = await scrapeSettingsFor(remote);
  const stored = await chrome.storage.local.get({ sweeps: {}, dedicatedWindow: true });
  const plan = Scrape.planRun({ group, settings, lastSweepAt: stored.sweeps[group.id], audit: Boolean(options && options.audit) });
  const result = { ok: true, postsFound: 0, newPosts: 0, scrolls: 0, stoppedBy: "", message: "", nextRunAt: null, mode: plan.mode, stats: null };
  let reader;
  try {
    const url = Scrape.scrapeUrl(group.url, kind);
    reader = await openReader(url, false);
    scrapingTabs.add(reader.tabId);
    let run = await readFeed(reader, kind, plan, group.knownKeys || [], result);
    // The background tab did not render more than one screen: read again in a small unfocused window.
    if (stored.dedicatedWindow && run.found <= 2 && run.stalls >= 2 && run.stoppedBy !== "seen") {
      await closeReader(reader);
      reader = await openReader(url, true);
      scrapingTabs.add(reader.tabId);
      const again = await readFeed(reader, kind, plan, group.knownKeys || [], result);
      again.stalls += run.stalls;
      again.usedWindow = true;
      if (again.found >= run.found) run = again;
    }
    const stats = Scrape.runStats(run);
    result.stats = { ...stats, usedWindow: Boolean(run.usedWindow) };
    result.scrolls = stats.scrolls;
    result.stoppedBy = run.stoppedBy || "end";
    result.postsFound = run.found;
    const picked = run.fresh;
    for (let i = 0; i < picked.length; i += 50) {
      const response = await sendPosts(cfg, group.url, picked.slice(i, i + 50).map(cleanPost));
      const data = response && response.ok ? await response.clone().json().catch(() => ({})) : {};
      result.newPosts += Number(data.inserted) || 0;
    }
    if (plan.mode !== "normal") {
      stored.sweeps[group.id] = Date.now();
      await chrome.storage.local.set({ sweeps: stored.sweeps });
    }
    if (kind !== "marketplace") {
      const cut = [...picked.filter((post) => post.truncated).map((post) => post.url), ...(group.refetchUrls || [])];
      const urls = [...new Set(cut.map(String))];
      if (urls.length) {
        const full = await readFullTexts(reader.tabId, kind, urls);
        if (full.length) {
          await sendPosts(cfg, group.url, full.map(cleanPost)).catch(() => undefined);
          result.fullTexts = full.length;
        }
      }
    }
    await postJson(cfg, "/api/v1/extension/sample", { sourceUrl: group.url, posts: result.sample || [] }).catch(() => undefined);
    result.message = `อ่านได้ ${run.found} โพสต์ ใหม่ ${result.newPosts} · เลื่อน ${result.scrolls} หน้าจอ (${plan.mode})`;
  } catch (error) {
    const message = String(error && error.message ? error.message : error).slice(0, 300);
    await rememberError(`อ่าน ${kind === "marketplace" ? "Marketplace" : "กลุ่ม"} ${group.name || group.url} ไม่สำเร็จ: ${message}`).catch(() => undefined);
    Object.assign(result, { ok: false, message });
  } finally {
    await closeReader(reader);
  }
  delete result.sample;
  result.nextRunAt = await reportRun(cfg, group, result);
  return result;
}
let cycling = false;
const RUN_LOCK_MS = 12 * 60 * 1000;

// One run at a time. The lock is also saved (with this worker's boot id and an expiry) so the popup
// and a restarted service worker can see it; a lock from an older boot is dead and is ignored.
async function takeRunLock(kind) {
  if (cycling) return false;
  cycling = true;
  const stored = await chrome.storage.session.get({ runLock: null }).catch(() => ({ runLock: null }));
  const lock = stored.runLock;
  if (lock && lock.boot === BOOT_ID && lock.until > Date.now()) {
    cycling = false;
    return false;
  }
  await chrome.storage.session.set({ runLock: { boot: BOOT_ID, kind, until: Date.now() + RUN_LOCK_MS } }).catch(() => undefined);
  return true;
}

async function releaseRunLock() {
  cycling = false;
  await chrome.storage.session.remove("runLock").catch(() => undefined);
}

async function cycle() {
  if (cycling) return;
  const cfg = await loadConfig();
  if (!cfg.enabled || !cfg.token) return;
  if (!(await takeRunLock("cycle"))) return;
  try {
    const response = await getJson(cfg, "/api/v1/extension-config");
    if (!response.ok) return;
    const remote = await response.json();
    const now = Date.now();
    const schedules = { ...cfg.schedules };
    // The server decides what is due (priority + adaptive interval); the local schedule is only a short lock.
    const due = (remote.groups || []).filter(
      (group) => (!remote.serverScheduling || group.due !== false) && (!schedules[group.id] || now >= schedules[group.id]),
    );
    const batch = due.slice(0, remote.maxGroupsPerCycle || 5);
    for (const group of batch) {
      schedules[group.id] = Date.now() + RUN_LOCK_MS;
      await chrome.storage.local.set({ schedules });
      const result = await scrapeGroup(cfg, group, remote);
      const interval = group.currentIntervalMinutes || group.intervalMinutes || remote.defaultIntervalMinutes || 10;
      const jitter = Math.random() * Math.min(remote.jitterMinutes ?? 5, interval * 0.25);
      schedules[group.id] = result.nextRunAt ? Math.min(result.nextRunAt, Date.now() + 180 * 60 * 1000) : Date.now() + (interval + jitter) * 60 * 1000;
      await chrome.storage.local.set({ schedules });
      if (batch.indexOf(group) < batch.length - 1) await sleep(4000 + Math.random() * 6000);
    }
  } catch (error) {
    // เปิดแอปไม่ติดหรือเน็ตหลุด — รอรอบถัดไป
    await rememberError(`รอบอ่านอัตโนมัติไม่สำเร็จ: ${String(error && error.message ? error.message : error).slice(0, 160)}`).catch(() => undefined);
  } finally {
    await releaseRunLock();
  }
}

const recentManual = new Map();

async function forwardManual(message, sender) {
  // Pages opened by the background scrape report through scrapeGroup, not here.
  if (sender && sender.tab && scrapingTabs.has(sender.tab.id)) return;
  const cfg = await loadConfig();
  if (!cfg.token) return;
  const key = message.sourceUrl;
  const last = recentManual.get(key) || 0;
  if (Date.now() - last < 20000) return;
  recentManual.set(key, Date.now());
  for (const [url, at] of recentManual) if (Date.now() - at > 60000) recentManual.delete(url);
  await sendPosts(cfg, message.sourceUrl, message.posts || []);
  await postJson(cfg, "/api/v1/extension/sample", {
    sourceUrl: message.sourceUrl,
    posts: (message.posts || []).slice(0, 8),
  }).catch(() => undefined);
}

async function pollTasks() {
  if (cycling) return;
  const cfg = await loadConfig();
  if (!cfg.token) return;
  if (!(await takeRunLock("tasks"))) return;
  try {
    const response = await getJson(cfg, "/api/v1/extension/tasks", { timeoutMs: 20000, retries: 0 });
    if (!response.ok) return;
    const data = await response.json();
    for (const task of data.tasks || []) {
      const result = await scrapeGroup(cfg, task, null, { audit: Boolean(task.audit) });
      await postJson(cfg, "/api/v1/extension/tasks", {
        id: task.id,
        status: result.ok ? "done" : "error",
        message: result.message,
        postsFound: result.postsFound,
      }).catch(() => undefined);
    }
  } catch {
    // แอปปิดอยู่
  } finally {
    await releaseRunLock();
  }
}

function armAlarms() {
  chrome.alarms.create("mybot-tick", { periodInMinutes: 1 });
  chrome.alarms.create("mybot-tasks", { periodInMinutes: 0.5 });
  chrome.alarms.create("mybot-heartbeat", { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  void syncCustomBridge();
  armAlarms();
  void heartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  void syncCustomBridge();
  armAlarms();
  void heartbeat();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "mybot-tick") void cycle();
  if (alarm.name === "mybot-tasks") void pollTasks();
  if (alarm.name === "mybot-heartbeat") {
    void heartbeat();
    void closeOrphanReaders().catch(() => undefined);
  }
});

// A fresh service worker (after Chrome stopped the old one) closes readers the old one left open
// and makes sure the alarms exist.
void closeOrphanReaders().catch(() => undefined);
void chrome.alarms.getAll().then((alarms) => { if (alarms.length < 3) armAlarms(); }).catch(() => undefined);

// Facebook pages report who is logged in (identity.js reads the c_user cookie value only).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "fb-identity") return;
  const fromFacebook = sender.tab && sender.url && globalThis.MyBotAssist.isFacebookUrl(sender.url);
  if (!fromFacebook) return;
  rememberIdentity(message.identity)
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "heartbeat-now") {
    heartbeat()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type !== "manual-posts") return;
  forwardManual(message, sender)
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

// ---- Assisted reply (owner-triggered only; the owner presses send in Facebook) ----
// MY-BOT opens a post, this worker shows the overlay there, and records the owner's "ส่งแล้ว / ข้าม".
// Auto-advance only opens the next post tab; it never clicks, types into or sends anything on Facebook.
const ASSIST_TTL_MS = 3 * 60 * 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const ADVANCE_ALARM = "mybot-advance";

function fromMyBotApp(senderUrl, apiBase) {
  try {
    const page = new URL(senderUrl);
    const app = new URL(apiBase);
    if (page.origin === app.origin) return true;
    return LOCAL_HOSTS.has(page.hostname) && LOCAL_HOSTS.has(app.hostname) && page.port === app.port;
  } catch {
    return false;
  }
}

function cleanId(value) {
  const id = String(value || "").trim();
  return /^[\w-]{1,64}$/.test(id) ? id : "";
}

function cleanTemplates(list, maxText) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 20)
    .map((item) => ({ id: cleanId(item && item.id), name: String((item && item.name) || "").slice(0, 60), text: String((item && item.text) || "").slice(0, maxText) }))
    .filter((item) => item.id && item.text.trim());
}

async function loadPendingAssist() {
  const stored = await chrome.storage.session.get({ pendingAssist: [] });
  return (stored.pendingAssist || []).filter((entry) => Date.now() - entry.at < ASSIST_TTL_MS);
}

async function addPending(entry) {
  const pending = (await loadPendingAssist()).slice(-4);
  pending.push({ ...entry, at: Date.now() });
  await chrome.storage.session.set({ pendingAssist: pending });
}

async function loadAssistTabs() {
  const stored = await chrome.storage.session.get({ assistTabs: {} });
  return stored.assistTabs || {};
}

async function setAssistTab(tabId, value) {
  const tabs = await loadAssistTabs();
  if (value) tabs[String(tabId)] = value;
  else delete tabs[String(tabId)];
  await chrome.storage.session.set({ assistTabs: tabs });
}

async function replyApi(cfg, body) {
  if (!cfg.token) return { ok: false, error: "ยังไม่ได้ใส่โทเคนในส่วนขยาย (กดไอคอน MY-BOT แล้วใส่โทเคน)" };
  try {
    const response = await postJson(cfg, "/api/v1/extension/reply-queue", body, { timeoutMs: 30000, retries: 0 });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error || `MY-BOT ตอบกลับ ${response.status}` };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: "ติดต่อ MY-BOT ไม่ได้ เปิดแอปอยู่หรือเปล่า" };
  }
}

async function acceptAssist(message, sender) {
  const cfg = await loadConfig();
  const assist = globalThis.MyBotAssist;
  if (!sender.tab || !sender.url || !fromMyBotApp(sender.url, base(cfg))) return { ok: false, error: "คำขอไม่ได้มาจากหน้า MY-BOT" };
  if (!assist.isFacebookUrl(message.url)) return { ok: false, error: "ลิงก์นี้ไม่ใช่โพสต์ Facebook" };
  const text = String(message.text || "").slice(0, assist.MAX_TEXT).trim();
  if (!text) return { ok: false, error: "ไม่มีข้อความ" };
  await addPending({
    id: message.nonce || String(Date.now()),
    key: assist.postKey(message.url),
    openerTabId: sender.tab.id,
    text,
    itemId: cleanId(message.itemId),
    postId: cleanId(message.postId),
    templates: cleanTemplates(message.templates, assist.MAX_TEXT),
    prefs: message.prefs && typeof message.prefs === "object" ? { autoMarkSent: Boolean(message.prefs.autoMarkSent), autoInsert: Boolean(message.prefs.autoInsert) } : {},
  });
  return { ok: true };
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url) return;
  const assist = globalThis.MyBotAssist;
  if (!assist.isFacebookUrl(tab.url)) return;
  void (async () => {
    const pending = await loadPendingAssist();
    const key = assist.postKey(tab.url);
    // Exact post match, the tab auto-advance navigated, or the tab MY-BOT itself just opened
    // (Facebook sometimes rewrites post URLs).
    const index = pending.findIndex(
      (entry) =>
        (entry.key && entry.key === key) ||
        (entry.tabId !== undefined && entry.tabId === tabId && Date.now() - entry.at < 60000) ||
        (tab.openerTabId !== undefined && tab.openerTabId === entry.openerTabId && Date.now() - entry.at < 30000),
    );
    if (index < 0) return;
    const [entry] = pending.splice(index, 1);
    await chrome.storage.session.set({ pendingAssist: pending });
    await setAssistTab(tabId, { itemId: entry.itemId || "", postId: entry.postId || "" });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["assist.js", "overlay.js"] });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (payload) => {
        globalThis.MyBotOverlay.mount(payload);
      },
      args: [{ text: entry.text, itemId: entry.itemId || "", postId: entry.postId || "", templates: entry.templates || [], prefs: entry.prefs || {} }],
    });
  })().catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void setAssistTab(tabId, null).catch(() => undefined);
});

// ---- Auto-advance: open the next queued lead once the gap and daily cap allow ----
async function notifyTab(tabId, message) {
  if (tabId === undefined || tabId === null) return;
  await chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
}

async function scheduleAdvance(tabId, waitMs) {
  const at = Date.now() + Math.max(0, waitMs) + 1500;
  await chrome.storage.session.set({ advance: { tabId: tabId ?? null, at } });
  await chrome.alarms.create(ADVANCE_ALARM, { when: at });
  // Alarms can fire late for short waits; a timer covers those while the worker is awake.
  if (waitMs < 25000) setTimeout(() => void runAdvance(), Math.max(0, waitMs) + 1500);
  return { at };
}

async function cancelAdvance() {
  await chrome.alarms.clear(ADVANCE_ALARM);
  await chrome.storage.session.remove("advance");
}

// Decide after a "sent/skip": schedule the next lead (with countdown) or explain why not.
async function planAdvance(tabId, advance) {
  if (!advance || !advance.prefs || !advance.prefs.autoAdvance) return { reason: "" };
  if (advance.decision === "ready" || advance.decision === "wait") return scheduleAdvance(tabId, advance.waitMs || 0);
  return { reason: advance.reason || "" };
}

let advancing = false;

async function runAdvance() {
  if (advancing) return;
  const stored = await chrome.storage.session.get({ advance: null });
  const plan = stored.advance;
  if (!plan || Date.now() < plan.at - 1000) return;
  advancing = true;
  try {
    await cancelAdvance();
    const cfg = await loadConfig();
    const result = await replyApi(cfg, { op: "next" });
    if (!result.ok) {
      await notifyTab(plan.tabId, { type: "advance-status", at: 0, reason: result.error });
      return;
    }
    if (!result.item) {
      const advance = result.advance || {};
      if (advance.decision === "wait" && advance.prefs && advance.prefs.autoAdvance) {
        const next = await scheduleAdvance(plan.tabId, advance.waitMs || 0);
        await notifyTab(plan.tabId, { type: "advance-status", at: next.at });
      } else {
        await notifyTab(plan.tabId, { type: "advance-status", at: 0, reason: advance.reason || "ไม่มีลีดถัดไป" });
      }
      return;
    }
    const assist = globalThis.MyBotAssist;
    const item = result.item;
    if (!assist.isFacebookUrl(item.url)) {
      await notifyTab(plan.tabId, { type: "advance-status", at: 0, reason: "ลีดถัดไปไม่ใช่ลิงก์ Facebook เปิดจากหน้า MY-BOT แทน" });
      return;
    }
    let tabId = plan.tabId;
    const existing = tabId !== null && tabId !== undefined ? await chrome.tabs.get(tabId).catch(() => null) : null;
    const prefs = (result.advance && result.advance.prefs) || {};
    const entry = {
      id: `adv-${Date.now()}`,
      key: assist.postKey(item.url),
      text: String(item.text || "").slice(0, assist.MAX_TEXT),
      itemId: cleanId(item.id),
      postId: cleanId(item.postId),
      templates: cleanTemplates(item.templates, assist.MAX_TEXT),
      prefs: { autoMarkSent: Boolean(prefs.autoMarkSent), autoInsert: Boolean(prefs.autoInsert) },
    };
    if (existing) {
      await addPending({ ...entry, tabId: existing.id });
      await chrome.tabs.update(existing.id, { url: item.url, active: true });
    } else {
      const created = await chrome.tabs.create({ url: item.url, active: true });
      tabId = created.id;
      await addPending({ ...entry, tabId });
    }
  } finally {
    advancing = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ADVANCE_ALARM) void runAdvance();
});

// The owner marked the lead in this Facebook tab (overlay button, detected comment, or keyboard shortcut).
async function finishFromTab(tabId, action, text, detected) {
  const tabs = await loadAssistTabs();
  const known = tabs[String(tabId)];
  if (!known || (!known.itemId && !known.postId)) return { ok: false, error: "แท็บนี้ไม่ได้เปิดจาก MY-BOT" };
  if (action === "skip" && !known.itemId) return { ok: false, error: "ข้ามได้เฉพาะลีดในคิว" };
  const cfg = await loadConfig();
  const result = await replyApi(cfg, {
    op: "finish",
    itemId: known.itemId || undefined,
    postId: known.itemId ? undefined : known.postId,
    action,
    text: typeof text === "string" && text.trim() ? text.slice(0, globalThis.MyBotAssist.MAX_TEXT) : undefined,
    detected: Boolean(detected),
  });
  if (!result.ok) return result;
  await setAssistTab(tabId, null);
  const advance = known.itemId ? await planAdvance(tabId, result.advance) : { reason: "" };
  return { ok: true, advance };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !sender.tab) return;
  if (message.type === "assist-finish") {
    if (message.action !== "sent" && message.action !== "skip") return;
    finishFromTab(sender.tab.id, message.action, message.text, message.detected)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "บันทึกไม่สำเร็จ" }));
    return true;
  }
  if (message.type === "assist-advance-cancel") {
    cancelAdvance()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

// Keyboard shortcuts (chrome://extensions/shortcuts): mark the lead in the active Facebook tab.
chrome.commands.onCommand.addListener((command) => {
  const action = command === "mark-sent" ? "sent" : command === "mark-skip" ? "skip" : "";
  if (!action) return;
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) return;
    const tabs = await loadAssistTabs();
    if (!tabs[String(tab.id)]) return;
    // Let the overlay do it so the edited draft is saved and the countdown shows; fall back to a direct call.
    const reply = await chrome.tabs.sendMessage(tab.id, { type: "command-finish", action }).catch(() => null);
    if (reply && reply.handled) return;
    const result = await finishFromTab(tab.id, action, undefined, false);
    if (result.ok && result.advance && result.advance.at) await notifyTab(tab.id, { type: "advance-status", at: result.advance.at });
  })().catch(() => undefined);
});

// Requests from the MY-BOT page (via bridge.js): open a post with the overlay, or plan/cancel auto-advance.
async function advanceFromApp(sender) {
  const cfg = await loadConfig();
  if (!sender.tab || !sender.url || !fromMyBotApp(sender.url, base(cfg))) return { ok: false, error: "คำขอไม่ได้มาจากหน้า MY-BOT" };
  const result = await replyApi(cfg, { op: "status" });
  if (!result.ok) return result;
  const plan = await planAdvance(null, result.advance);
  return { ok: true, at: plan.at || 0, reason: plan.reason || "" };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.type === "assist-reply") {
    acceptAssist(message, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "ส่วนขยายรับคำขอไม่ได้" }));
    return true;
  }
  if (message.type === "queue-advance") {
    advanceFromApp(sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "ส่วนขยายรับคำขอไม่ได้" }));
    return true;
  }
  if (message.type === "queue-advance-cancel") {
    void loadConfig().then((cfg) => {
      if (!sender.tab || !sender.url || !fromMyBotApp(sender.url, base(cfg))) return sendResponse({ ok: false });
      return cancelAdvance().then(() => sendResponse({ ok: true }));
    });
    return true;
  }
});
