importScripts("assist.js", "identity.js", "scrape.js", "quiet.js");
importScripts("browser-comment.js", "comment-worker.js");

const DEFAULTS = {
  apiBase: "https://my-bot-e6bt.onrender.com",
  token: "",
  // Paired = reading starts on its own; "paused" is the owner's pause switch in the popup.
  paused: false,
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
let outboxLock = Promise.resolve();
function withOutboxLock(fn) {
  const task = outboxLock.then(fn); outboxLock = task.catch(() => undefined); return task;
}
// Serialize chrome.storage read-modify-write for parallel scrapes (backlog / sweeps / reader window).
let backlogLock = Promise.resolve();
function withBacklogLock(fn) {
  const task = backlogLock.then(fn); backlogLock = task.catch(() => undefined); return task;
}
let sweepsLock = Promise.resolve();
function withSweepsLock(fn) {
  const task = sweepsLock.then(fn); sweepsLock = task.catch(() => undefined); return task;
}
let scrapeWindowLock = Promise.resolve();
function withScrapeWindowLock(fn) {
  const task = scrapeWindowLock.then(fn); scrapeWindowLock = task.catch(() => undefined); return task;
}
// Cap true parallelism so Facebook is not hit by every due group at once (batch can still be larger).
const PARALLEL_SCRAPE = 3;
async function mapPool(items, concurrency, worker) {
  const list = items || [];
  const results = new Array(list.length);
  let cursor = 0;
  async function workerLoop() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(list[index], index);
    }
  }
  const n = Math.max(1, Math.min(concurrency, list.length || 1));
  await Promise.all(Array.from({ length: n }, () => workerLoop()));
  return results;
}
function outboxId() { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === "x" ? n : (n & 3) | 8).toString(16); }); }
async function loadOutbox() {
  const stored = await chrome.storage.local.get({ outbox: [] });
  return (Array.isArray(stored.outbox) ? stored.outbox : []).filter(Boolean);
}
async function queueOutbox(item) {
  return withOutboxLock(async () => {
    const outbox = await loadOutbox();
    if (outbox.length >= OUTBOX_MAX) {
      const stats = await chrome.storage.local.get({ outboxRejectedItems: 0 });
      await chrome.storage.local.set({ outboxBlocked: true, outboxRejectedItems: stats.outboxRejectedItems + item.posts.length });
      await rememberError("คิวข้อมูลเต็ม หยุดอ่านเพิ่ม กรุณาตรวจรายการค้างในส่วนขยาย");
      throw new Error("outbox full");
    }
    const queued = { ...item, batchId: outboxId(), posts: item.posts.map(post => ({ ...post, itemId: outboxId() })), at: Date.now() };
    outbox.push(queued); await chrome.storage.local.set({ outbox, outboxBlocked: false }); return queued;
  });
}
let flushing = false;
async function flushOutbox(cfg) {
  if (flushing || cfg.paused || !cfg.token) return;
  flushing = true;
  const results = {};
  try {
    for (let sent = 0; sent < 10; sent++) {
      const item = (await loadOutbox()).find(entry => !entry.problem);
      if (!item || (item.apiBase && item.apiBase !== base(cfg))) break;
      if (Date.now() - item.at >= OUTBOX_MAX_AGE_MS) {
        await withOutboxLock(async () => { const entries = await loadOutbox(); const match = entries.find(e => item.batchId ? e.batchId === item.batchId : e.at === item.at && e.sourceUrl === item.sourceUrl); if (match) match.problem = "expired"; await chrome.storage.local.set({ outbox: entries }); });
        await rememberError("ข้อมูลค้างเกิน 72 ชั่วโมง เก็บไว้ให้ตรวจเอง ไม่ลบทิ้งเงียบ ๆ"); continue;
      }
      const response = await postJson(cfg, "/api/v1/ingest", { ...(item.batchId ? { batchId: item.batchId } : {}), sourceUrl: item.sourceUrl, posts: item.posts, fbUserId: item.fbUserId || undefined }, { timeoutMs: 45000, retries: 0 }).catch(() => null);
      if (!response || RETRY_STATUS.has(response.status) || response.status >= 500) break;
      if ([401, 403].includes(response.status)) { await rememberError("การเชื่อมต่อหมดสิทธิ์ ข้อมูลยังอยู่ในคิว กรุณาจับคู่ Extension ใหม่"); break; }
      const data = response.json ? await response.json().catch(() => ({})) : {};
      const ack = new Set(response.ok && data.batchId === item.batchId ? (data.receipts || []).filter(r => ["accepted", "skipped"].includes(r.outcome)).map(r => r.itemId) : []);
      if (response.ok && item.batchId && !ack.size) break; // old server: retain until upgraded
      await withOutboxLock(async () => {
        const entries = await loadOutbox();
        const index = entries.findIndex(entry => item.batchId ? entry.batchId === item.batchId : entry.at === item.at && entry.sourceUrl === item.sourceUrl);
        if (index < 0) return;
        if (!response.ok) entries[index].problem = `http_${response.status}`;
        else if (item.batchId) { entries[index].posts = entries[index].posts.filter(post => !ack.has(post.itemId)); if (!entries[index].posts.length) entries.splice(index, 1); }
        else entries.splice(index, 1); // compatibility for batches saved by older extension
        await chrome.storage.local.set({ outbox: entries, outboxBlocked: entries.length >= OUTBOX_MAX });
      });
      if (!response.ok) {
        // Permanent client errors: keep in outbox marked, but do not re-alert every heartbeat.
        if (response.status === 404 || response.status === 400) {
          await rememberError(`คิวข้อมูลถูกปฏิเสธ HTTP ${response.status} (${String(item.sourceUrl || "").slice(0, 80)}) — ทำเครื่องหมายแล้ว ไม่ส่งซ้ำ`).catch(() => undefined);
        } else {
          await rememberError(`ข้อมูลถูกปฏิเสธ HTTP ${response.status} เก็บไว้ให้ตรวจ ไม่ลบออกจากคิว`);
        }
        continue;
      }
      results[item.batchId] = data;
      await countSent(Number(data.inserted) || 0);
    }
    return results;
  } finally { flushing = false; }
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

// After install/update, content scripts do not run on tabs that were already open.
// Probe open Facebook tabs with executeScript so pairing can start reading without a manual reload.
async function probeFacebookIdentity() {
  const tabs = await chrome.tabs
    .query({
      url: ["https://www.facebook.com/*", "https://facebook.com/*", "https://web.facebook.com/*"],
    })
    .catch(() => []);
  for (const tab of tabs.slice(0, 8)) {
    if (!tab.id || tab.status === "loading") continue;
    try {
      const [executed] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const raw = String(document.cookie || "");
          const parts = raw.split(";");
          let id = "";
          for (const part of parts) {
            const trimmed = part.trim();
            const index = trimmed.indexOf("=");
            if (index > 0 && trimmed.slice(0, index) === "c_user") {
              id = decodeURIComponent(trimmed.slice(index + 1).trim());
              break;
            }
          }
          if (!/^\d{5,20}$/.test(id)) return { loggedIn: false, id: "", name: "" };
          return { loggedIn: true, id, name: "" };
        },
      });
      const identity = executed && executed.result;
      if (identity && identity.loggedIn) {
        await rememberIdentity(identity);
        return identity;
      }
    } catch {
      // Restricted tab or extension mid-reload — try the next one.
    }
  }
  return null;
}

async function currentFbUserId() {
  const stored = await chrome.storage.local.get({ fbIdentity: null });
  return stored.fbIdentity && stored.fbIdentity.loggedIn ? stored.fbIdentity.id : "";
}

async function sendPosts(cfg, sourceUrl, posts) {
  if (!posts.length) return null;
  const fbUserId = await currentFbUserId();
  const queued = await queueOutbox({ sourceUrl, posts, fbUserId, apiBase: base(cfg) });
  const result = (await flushOutbox(cfg))?.[queued.batchId];
  return result ? { ok: true, clone: () => ({ json: async () => result }) } : null;
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
    await probeFacebookIdentity();
    const stored = await chrome.storage.local.get({ fbIdentity: null, lastError: null, lastPostAt: 0, postsSent: 0, profileLabel: "", quiet: null, browserCommentsEnabled: false, commentJournal: null });
    const outbox = await loadOutbox();
    const fb = stored.fbIdentity || { loggedIn: false, id: "", name: "", at: 0 };
    const response = await postJson(cfg, "/api/v1/extension/heartbeat", {
      installId: await installId(),
      version: chrome.runtime.getManifest().version,
      browser: browserName(),
      profileLabel: String(stored.profileLabel || "").slice(0, 60),
      enabled: !cfg.paused,
      fb: { loggedIn: Boolean(fb.loggedIn), id: fb.id || "", name: fb.name || "", checkedAt: fb.at || 0 },
      tabs: await readingTabs(),
      lastError: stored.lastError || null,
      lastPostAt: stored.lastPostAt || 0,
      postsSent: stored.postsSent || 0,
      errors: await errorSummary(),
      outboxSize: outbox.length,
      runtime: { quietReason: stored.quiet?.reason || "", commentsEnabled: Boolean(stored.browserCommentsEnabled), commentPending: Boolean(stored.commentJournal) },
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

// Full-text re-reads: at most this many permalinks per cycle (shared by all groups) and a time budget per group.
const MAX_FULL_TEXT_PER_ROUND = 10;
const FULL_TEXT_BUDGET_MS = 30 * 1000;
const FULL_TEXT_MAX_TRIES = 4;
let fullTextBudget = MAX_FULL_TEXT_PER_ROUND;

// Local backlog of truncated posts not read yet (budget ran out or the read failed); retried with backoff.
async function loadFullTextBacklog() {
  const { fullTextBacklog } = await chrome.storage.local.get({ fullTextBacklog: {} });
  const now = Date.now();
  const kept = {};
  for (const [url, item] of Object.entries(fullTextBacklog || {})) {
    if (!item) continue;
    if (!item.problem && now - (item.addedAt || 0) >= 3 * 24 * 3600 * 1000) item.problem = "expired";
    if (!item.problem && (item.tries || 0) >= FULL_TEXT_MAX_TRIES) item.problem = "retry_exhausted";
    kept[url] = item;
  }
  return kept;
}

async function saveFullTextBacklog(backlog) {
  const entries = Object.entries(backlog).sort((a, b) => (a[1].addedAt || 0) - (b[1].addedAt || 0));
  const dropped = entries.slice(200);
  const previous = await chrome.storage.local.get({ fullTextOverflow: 0 });
  await chrome.storage.local.set({ fullTextBacklog: Object.fromEntries(entries.slice(0, 200)), fullTextOverflow: previous.fullTextOverflow + dropped.length });
  if (dropped.length) await rememberError("คิวอ่านข้อความเต็มเกิน 200 รายการ มีงานไม่รับเพิ่ม กรุณาตรวจสถิติคิวและลดจำนวนกลุ่ม");
}

async function updateFullTextBacklog(mutator) {
  return withBacklogLock(async () => {
    const backlog = await loadFullTextBacklog();
    await mutator(backlog);
    await saveFullTextBacklog(backlog);
    return backlog;
  });
}

async function noteSweepAt(groupId) {
  return withSweepsLock(async () => {
    const stored = await chrome.storage.local.get({ sweeps: {} });
    const sweeps = { ...(stored.sweeps || {}) };
    sweeps[groupId] = Date.now();
    await chrome.storage.local.set({ sweeps });
  });
}

function postKey(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:" || !["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"].includes(parsed.hostname) || parsed.username || parsed.password || parsed.port) return "";
    if (parsed.searchParams.has("comment_id") || parsed.searchParams.has("reply_comment_id")) return "";
    const path = parsed.pathname.match(/^\/groups\/([a-zA-Z0-9._-]+)(?:\/(?:posts|permalink)\/(\d+))?\/?$/);
    if (path) {
      const ids = parsed.searchParams.getAll("multi_permalinks");
      if (ids.length > 1 || (ids.length && !/^\d+$/.test(ids[0]))) return "";
      if (path[2] && ids.length && path[2] !== ids[0]) return "";
      const id = path[2] || ids[0];
      return id ? `group:${path[1]}:${id}` : "";
    }
    const item = parsed.pathname.match(/^\/marketplace\/item\/(\d+)\/?$/);
    return item ? `marketplace:${item[1]}` : "";
  } catch { return ""; }
}

// Posts cut off at "See more": open each permalink in the same background tab and read the text
// Facebook shows there. Navigation and reading only; nothing on the page is clicked.
async function readFullTexts(tabId, kind, urls) {
  const found = [];
  const failed = [];
  const tried = [];
  const failures = {};
  const deadline = Date.now() + FULL_TEXT_BUDGET_MS;
  for (const url of urls) {
    if (fullTextBudget <= 0 || Date.now() > deadline) break;
    fullTextBudget -= 1;
    tried.push(url);
    try {
      await chrome.tabs.update(tabId, { url });
      await waitComplete(tabId);
      await injectReaders(tabId);
      const targetKey = postKey(url);
      let match = null;
      let reason = "target_not_found";
      // document.readyState=complete precedes React's post content. Poll the
      // exact target, never infer success from some other article on the page.
      for (let attempt = 0; attempt < 4 && Date.now() < deadline; attempt++) {
        const page = await readPage(tabId, kind);
        if (page.identity?.loggedIn === false) { reason = "facebook_logged_out"; break; }
        const target = targetKey ? (page.posts || []).find(post => postKey(post.url) === targetKey) : null;
        if (target && !target.truncated && String(target.text || "").trim()) { match = target; break; }
        reason = target ? "text_still_truncated" : "target_not_found";
        if (attempt < 3) await sleep(Math.min(1500, Math.max(0, deadline - Date.now())));
      }
      if (match) found.push({ ...match, url });
      else { failed.push(url); failures[url] = reason; }
    } catch {
      failed.push(url); failures[url] = "navigation_or_parser_error"; // No send, retry later.
    }
  }
  return { found, failed, tried, failures };
}

// Wait (read-only) until the feed shows more posts or grows, using a MutationObserver in the page.
async function waitForGrowth(tabId, kind, before, timeoutMs) {
  if (timeoutMs <= 0) return { count: before || 0, grew: false, height: 0 };
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

const READER_FILES = ["selectors.js", "fbtime.js", "parser.js", "identity.js"];

// Chrome sometimes fails the first executeScript with "Could not load file: 'selectors.js'"
// right after navigation or while the extension is reloading — retry a few times.
async function injectReaders(tabId) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: READER_FILES });
      return;
    } catch (err) {
      lastError = err;
      await sleep(350 * (attempt + 1));
    }
  }
  throw lastError || new Error("Could not inject readers");
}

// Reading happens as background tabs inside the owner's already-open Chrome window.
// Never create a second Chrome window/popup and never move or focus the owner's window.
const BOOT_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const READER_MAX_AGE_MS = 15 * 60 * 1000;
let scrapeWindowRef = null;
let lastOwnerWindowId = null;

async function loadScrapeWindow() {
  if (scrapeWindowRef) return scrapeWindowRef;
  const stored = await chrome.storage.session.get({ scrapeWindow: null }).catch(() => ({ scrapeWindow: null }));
  scrapeWindowRef = stored.scrapeWindow || null;
  return scrapeWindowRef;
}

async function saveScrapeWindow(ref) {
  scrapeWindowRef = ref;
  if (ref) await chrome.storage.session.set({ scrapeWindow: ref }).catch(() => undefined);
  else await chrome.storage.session.remove("scrapeWindow").catch(() => undefined);
}

// Only tabs we opened for scrape — not every tab in the owner's window.
function isScrapeWindowTab(tab) {
  return Boolean(tab && tab.id !== undefined && scrapingTabs.has(tab.id));
}

function readerWindowState(win) {
  if (!win) return "unknown";
  if (win.state === "minimized") return "minimized";
  return win.state || "normal";
}

function isNormalChromeWindow(win) {
  return Boolean(win && win.id !== undefined && win.type !== "popup" && win.type !== "devtools");
}

const FB_TAB_URLS = ["*://www.facebook.com/*", "*://facebook.com/*", "*://web.facebook.com/*", "*://m.facebook.com/*"];

async function findOwnerWindowId() {
  // Always prefer the Chrome window that already has Facebook open (the connected session).
  const fbTabs = await chrome.tabs.query({ url: FB_TAB_URLS }).catch(() => []);
  for (const tab of fbTabs) {
    if (tab.windowId === undefined) continue;
    const win = await chrome.windows.get(tab.windowId).catch(() => null);
    if (isNormalChromeWindow(win)) {
      lastOwnerWindowId = win.id;
      return win.id;
    }
  }
  if (lastOwnerWindowId != null) {
    const remembered = await chrome.windows.get(lastOwnerWindowId).catch(() => null);
    if (isNormalChromeWindow(remembered)) return remembered.id;
  }
  return undefined;
}

// Host = owner's Facebook Chrome window only. Never create a popup/about:blank window.
async function ensureScrapeWindow() {
  const windowId = await findOwnerWindowId();
  if (windowId === undefined) throw new Error("เปิด facebook.com ใน Chrome ที่จับคู่ส่วนขยายไว้ค้างไว้ก่อน ระบบจะอ่านจากหน้าต่างนั้น");
  const win = await chrome.windows.get(windowId, { populate: true }).catch(() => null);
  if (!isNormalChromeWindow(win)) throw new Error("ไม่พบหน้าต่าง Chrome ที่มี Facebook");
  const hasFb = (win.tabs || []).some((tab) => isFacebookTab(tab));
  if (!hasFb) throw new Error("เปิดแท็บ facebook.com ในหน้าต่างนี้ค้างไว้ก่อน");
  const anchor = (win.tabs || []).find((tab) => tab.active) || (win.tabs || [])[0];
  const next = { windowId: win.id, tabId: anchor && anchor.id, usedAt: Date.now(), host: "owner" };
  lastOwnerWindowId = win.id;
  await saveScrapeWindow(next);
  return next;
}

chrome.windows.onRemoved.addListener((windowId) => {
  void loadScrapeWindow().then((ref) => { if (ref && ref.windowId === windowId) return saveScrapeWindow(null); });
  if (lastOwnerWindowId === windowId) lastOwnerWindowId = null;
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.windows.get(windowId).then((win) => {
    if (isNormalChromeWindow(win)) lastOwnerWindowId = windowId;
  }).catch(() => undefined);
});

async function closeOrphanReaders() {
  const stored = await chrome.storage.session.get({ readers: {} });
  const readers = stored.readers || {};
  let changed = false;
  for (const [key, reader] of Object.entries(readers)) {
    const orphan = reader.boot !== BOOT_ID || (!cycling && Date.now() - (reader.at || 0) > READER_MAX_AGE_MS);
    if (!orphan) continue;
    // Never close the owner's Chrome window. Restore reused Facebook tabs; only remove tabs we created.
    if (reader.tabId !== undefined && reader.tabId !== null) {
      if (reader.previousUrl) await chrome.tabs.update(reader.tabId, { url: reader.previousUrl, active: false }).catch(() => undefined);
      else await chrome.tabs.remove(reader.tabId).catch(() => undefined);
    }
    scrapingTabs.delete(reader.tabId);
    delete readers[key];
    changed = true;
  }
  if (changed) await chrome.storage.session.set({ readers });
}

// Use the connected Facebook window: reuse an idle FB tab when possible, else a background tab.
async function openReader(url) {
  const reader = await withScrapeWindowLock(async () => {
    const ref = await ensureScrapeWindow();
    const tabs = await chrome.tabs.query({ windowId: ref.windowId }).catch(() => []);
    // Prefer an already-open Facebook tab that the owner is not looking at (same login session).
    const reusable = (tabs || []).find(
      (tab) => tab.id !== undefined && !tab.active && !tab.pinned && !scrapingTabs.has(tab.id) && isFacebookTab(tab),
    );
    let tabId;
    let previousUrl = null;
    let ephemeral = true;
    if (reusable) {
      tabId = reusable.id;
      previousUrl = reusable.url || null;
      ephemeral = false;
      await chrome.tabs.update(tabId, { url, active: false }).catch(() => undefined);
    } else if (url === "about:blank") {
      const tab = await chrome.tabs.create({ windowId: ref.windowId, url: "about:blank", active: false });
      tabId = tab.id;
    } else {
      const tab = await chrome.tabs.create({ windowId: ref.windowId, url, active: false });
      tabId = tab.id;
    }
    scrapingTabs.add(tabId);
    const stored = await chrome.storage.session.get({ readers: {} }).catch(() => ({ readers: {} }));
    const readers = stored.readers || {};
    readers[String(tabId)] = { tabId, windowId: ref.windowId, boot: BOOT_ID, at: Date.now(), previousUrl };
    await chrome.storage.session.set({ readers }).catch(() => undefined);
    return { tabId, windowId: ref.windowId, ephemeral, previousUrl };
  });
  await sleep(400);
  return reader;
}

async function closeReader(reader) {
  if (!reader) return;
  scrapingTabs.delete(reader.tabId);
  if (reader.tabId !== undefined) {
    if (reader.previousUrl) await chrome.tabs.update(reader.tabId, { url: reader.previousUrl, active: false }).catch(() => undefined);
    else if (reader.ephemeral) await chrome.tabs.remove(reader.tabId).catch(() => undefined);
    const stored = await chrome.storage.session.get({ readers: {} }).catch(() => ({ readers: {} }));
    const readers = stored.readers || {};
    if (readers[String(reader.tabId)]) {
      delete readers[String(reader.tabId)];
      await chrome.storage.session.set({ readers }).catch(() => undefined);
    }
  }
  const ref = await loadScrapeWindow();
  if (ref) await saveScrapeWindow({ ...ref, usedAt: Date.now() });
}

// Scroll and read one feed until the stop rule fires. Returns the run (see scrape.js).
async function readFeed(reader, kind, plan, knownKeys, result) {
  const Scrape = globalThis.MyBotScrape;
  const tabId = reader.tabId;
  const run = Scrape.createRun({ knownKeys, ...plan });
  const feedDeadline = Date.now() + 45_000;
  const remaining = cap => Math.max(0, Math.min(cap, feedDeadline - Date.now()));
  await waitComplete(tabId).catch(() => undefined);
  await injectReaders(tabId);
  let state = await waitForGrowth(tabId, kind, 0, remaining(8000));
  if (!state.count) {
    run.stalls += 1;
    if (remaining(1500)) await sleep(remaining(1500));
    state = await waitForGrowth(tabId, kind, 0, remaining(4000));
  }
  const first = await readPage(tabId, kind);
  if (first.identity) await rememberIdentity(first.identity);
  if (first.groupId) result.groupId = first.groupId;
  result.sample = (first.posts || []).slice(0, 8);
  let stop = Scrape.addStep(run, first.posts);
  while (!stop && Date.now() < feedDeadline) {
    const before = state.count;
    const previousKeys = new Set((await readPage(tabId, kind)).posts?.map(post => postKey(post.url)).filter(Boolean) || []);
    await scrollOneScreen(tabId);
    await sleep(remaining(Scrape.scrollWaitMs()));
    state = await waitForGrowth(tabId, kind, before, remaining(2500));
    const immediate = await readPage(tabId, kind);
    if ((immediate.posts || []).some(post => { const key = postKey(post.url); return key && !previousKeys.has(key); })) state.grew = true;
    for (let retry = 0; !state.grew && retry < 1 && remaining(1) > 0; retry += 1) {
      run.stalls += 1;
      await nudgeScroll(tabId);
      state = await waitForGrowth(tabId, kind, before, remaining(2500));
    }
    const page = await readPage(tabId, kind);
    stop = Scrape.addStep(run, page.posts);
  }
  if (!stop && Date.now() >= feedDeadline) run.stoppedBy = "limit";
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
  const stored = await chrome.storage.local.get({ sweeps: {} });
  const plan = Scrape.planRun({ group, settings, lastSweepAt: (stored.sweeps || {})[group.id], audit: Boolean(options && options.audit) });
  const result = { ok: true, postsFound: 0, newPosts: 0, scrolls: 0, stoppedBy: "", message: "", nextRunAt: null, mode: plan.mode, stats: null };
  const startedAt = Date.now();
  let reader;
  try {
    const url = Scrape.scrapeUrl(group.url, kind);
    reader = await openReader(url);
    const win = reader.windowId !== undefined ? await chrome.windows.get(reader.windowId).catch(() => null) : null;
    const reading = { windowState: readerWindowState(win), reloaded: false, stallsFirst: 0, stallsRetry: 0, throttled: false };
    let run = await readFeed(reader, kind, plan, group.knownKeys || [], result);
    reading.stallsFirst = run.stalls || 0;
    // Background windows can still stall. Reload once and read again; never focus the reader.
    if (run.found === 0 && run.stalls >= 2 && run.stoppedBy !== "seen" && Date.now() - startedAt < 30_000) {
      await chrome.tabs.reload(reader.tabId).catch(() => undefined);
      await sleep(2500);
      reading.reloaded = true;
      const again = await readFeed(reader, kind, plan, group.knownKeys || [], result);
      reading.stallsRetry = again.stalls || 0;
      again.stalls += run.stalls;
      if (again.found >= run.found) run = again;
      if (run.found <= 2) {
        reading.throttled = true;
        await chrome.storage.local.set({ throttledAt: Date.now() }).catch(() => undefined);
      }
    }
    const stats = Scrape.runStats(run);
    result.stats = { ...stats, usedWindow: false, ...reading, fullTried: 0, fullOk: 0, durationMs: 0, extVersion: chrome.runtime.getManifest().version };
    result.scrolls = stats.scrolls;
    result.stoppedBy = run.stoppedBy || "end";
    result.postsFound = run.found;
    const picked = run.fresh;
    for (let i = 0; i < picked.length; i += 40) {
      const response = await sendPosts(cfg, group.url, picked.slice(i, i + 40).map(cleanPost));
      const data = response && response.ok ? await response.clone().json().catch(() => ({})) : {};
      result.newPosts += Number(data.inserted) || 0;
    }
    if (plan.mode !== "normal") await noteSweepAt(group.id);
    if (kind !== "marketplace") {
      // Discovery only enqueues work under a lock so parallel groups do not clobber each other.
      await updateFullTextBacklog(async (backlog) => {
        const now = Date.now();
        const freshCut = picked.filter((post) => post.truncated).map((post) => String(post.url));
        const urls = [...new Set([...freshCut, ...(group.refetchUrls || []).map(String)])];
        for (const url of urls) if (!backlog[url]) backlog[url] = { groupId: group.id, sourceUrl: group.url, tries: 0, addedAt: now, after: 0 };
      });
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
  if (result.stats) result.stats.durationMs = Date.now() - startedAt;
  result.nextRunAt = await reportRun(cfg, group, result);
  return result;
}
async function processFullTextQueue(cfg, groups, options = {}) {
  const metrics = { at: Date.now(), tried: 0, succeeded: 0, failed: 0, remaining: 0, durationMs: 0 };
  const detailDeadline = Date.now() + (options.budgetMs || 60_000);
  let backlogSnapshot = await loadFullTextBacklog();
  const now = Date.now();
  // Oldest due first; cap per group so a busy source cannot monopolize details.
  const used = new Map();
  const pending = Object.entries(backlogSnapshot).filter(([, item]) => !item.problem && (item.after || 0) <= now)
    .sort((a, b) => (a[1].lastTriedAt || 0) - (b[1].lastTriedAt || 0) || (a[1].addedAt || 0) - (b[1].addedAt || 0));
  // Round robin sources: two consecutive slow items cannot consume the whole budget.
  const queues = new Map();
  for (const entry of pending) { const id = entry[1].groupId; if (!queues.has(id)) queues.set(id, []); queues.get(id).push(entry); }
  const due = [];
  for (let pass = 0; pass < 2; pass++) for (const queue of queues.values()) if (queue.length) due.push(queue.shift());
  for (const [url, item] of due) {
    if (fullTextBudget <= 0 || metrics.tried >= (options.maxItems || 10) || Date.now() >= detailDeadline) break;
    const group = groups.find(g => g.id === item.groupId);
    if (!group || (used.get(group.id) || 0) >= 2) continue;
    const latest = await loadConfig(); if (latest.paused || latest.token !== cfg.token || base(latest) !== base(cfg)) break;
    used.set(group.id, (used.get(group.id) || 0) + 1);
    let reader;
    try {
      reader = await openReader("about:blank");
      metrics.tried += 1;
      await updateFullTextBacklog(async (backlog) => {
        if (!backlog[url]) return;
        backlog[url].lastTriedAt = Date.now();
      });
      const read = await readFullTexts(reader.tabId, sourceKind(group), [url]);
      await updateFullTextBacklog(async (backlog) => {
        if (read.found.length) {
          metrics.succeeded += 1;
          delete backlog[url];
        } else if (backlog[url]) {
          metrics.failed += 1;
          backlog[url].lastReason = read.failures?.[url] || "target_not_found";
          backlog[url].tries = (backlog[url].tries || 0) + 1;
          backlog[url].after = Date.now() + Math.min(6 * 3600000, 60000 * 2 ** backlog[url].tries);
        }
      });
      if (read.found.length) await sendPosts(cfg, group.url, read.found.map(cleanPost));
    } catch {
      metrics.failed += 1;
      await updateFullTextBacklog(async (backlog) => {
        if (!backlog[url]) return;
        backlog[url].tries = (backlog[url].tries || 0) + 1;
        backlog[url].after = Date.now() + 5 * 60_000;
      });
    } finally { await closeReader(reader); }
  }
  backlogSnapshot = await loadFullTextBacklog();
  metrics.remaining = Object.keys(backlogSnapshot).length; metrics.durationMs = Date.now() - metrics.at;
  metrics.reasons = Object.values(backlogSnapshot).reduce((counts, item) => { if (item.lastReason) counts[item.lastReason] = (counts[item.lastReason] || 0) + 1; return counts; }, {});
  metrics.review = Object.values(backlogSnapshot).filter(item => item.problem).length;
  metrics.oldestAgeMs = Object.values(backlogSnapshot).reduce((age, item) => Math.max(age, Date.now() - (item.addedAt || Date.now())), 0);
  const { fullTextTotals: previous = {} } = await chrome.storage.local.get({ fullTextTotals: {} });
  await chrome.storage.local.set({ fullTextMetrics: metrics, fullTextTotals: { tried: (previous.tried || 0) + metrics.tried, succeeded: (previous.succeeded || 0) + metrics.succeeded, failed: (previous.failed || 0) + metrics.failed } });
}
let cycling = false;
const RUN_LOCK_MS = 12 * 60 * 1000;

// One run at a time. The lock is also saved (with this worker's boot id and an expiry) so the popup
// and a restarted service worker can see it; a lock from an older boot is dead and is ignored.
async function takeRunLock(kind) {
  if (cycling) return false;
  cycling = true;
  fullTextBudget = MAX_FULL_TEXT_PER_ROUND;
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
  if ((await chrome.storage.local.get({ outboxBlocked: false })).outboxBlocked) return;
  if (cycling) return;
  const cfg = await loadConfig();
  if (cfg.paused || !cfg.token) return;
  // Facebook logged out (seen in the last 30 min): wait; a later cycle probes again.
  await probeFacebookIdentity();
  const fbState = await chrome.storage.local.get({ fbIdentity: null });
  const fb = fbState.fbIdentity;
  if (fb && fb.loggedIn === false && Date.now() - (fb.at || 0) < 30 * 60 * 1000) return void (await setQuiet("ยังไม่ได้เข้าสู่ระบบ Facebook"));
  if (fb && fb.loggedIn) await setQuiet("");
  if (!(await takeRunLock("cycle"))) return;
  try {
    const response = await getJson(cfg, "/api/v1/extension-config");
    if (!response.ok) return;
    const remote = await response.json();
    const reason = await quietReason(remote.quiet);
    await setQuiet(reason);
    if (reason) return;
    const now = Date.now();
    const schedules = { ...cfg.schedules };
    // Local nextRunAt / in-flight lock always wins — prevents re-scraping every tick when server due is stale.
    const INFLIGHT_MS = 2 * 60 * 1000;
    const due = (remote.groups || []).filter((group) => {
      if (remote.serverScheduling && group.due === false) return false;
      const until = schedules[group.id] || 0;
      if (until > now) return false;
      return true;
    });
    // Chrome throttled recently → smaller batch. Otherwise take every due group (up to maxGroupsPerCycle).
    const { throttledAt } = await chrome.storage.local.get({ throttledAt: 0 });
    const limit = remote.maxGroupsPerCycle || 20;
    const batch = due.slice(0, Date.now() - throttledAt < 30 * 60 * 1000 ? Math.min(limit, 2) : limit);
    if (Object.keys(await loadFullTextBacklog()).length >= 10) await processFullTextQueue(cfg, remote.groups || [], { budgetMs: 20000, maxItems: 2 });
    const started = Date.now();
    for (const group of batch) schedules[group.id] = started + INFLIGHT_MS;
    await chrome.storage.local.set({ schedules });
    // Up to PARALLEL_SCRAPE tabs at once, staggered; remaining due groups queue in the same cycle.
    const settled = await mapPool(batch, PARALLEL_SCRAPE, async (group, index) => {
      if (index > 0) await sleep(1200 * Math.min(index, PARALLEL_SCRAPE));
      if (await quietReason(remote.quiet)) return { group, result: { ok: false, message: "quiet", nextRunAt: Date.now() + 60_000 } };
      const result = await scrapeGroup(cfg, group, remote);
      return { group, result };
    });
    for (const { group, result } of settled) {
      if (!result) continue;
      const interval = group.currentIntervalMinutes || group.intervalMinutes || remote.defaultIntervalMinutes || 10;
      schedules[group.id] = result.nextRunAt
        ? Math.min(result.nextRunAt, Date.now() + 180 * 60 * 1000)
        : Date.now() + interval * 60 * 1000;
    }
    await chrome.storage.local.set({ schedules });
    if (!await quietReason(remote.quiet)) await processFullTextQueue(cfg, remote.groups || []);
    await scheduleDueWake(remote.groups || [], schedules);
  } catch (error) {
    // เปิดแอปไม่ติดหรือเน็ตหลุด — รอรอบถัดไป
    await rememberError(`รอบอ่านอัตโนมัติไม่สำเร็จ: ${String(error && error.message ? error.message : error).slice(0, 160)}`).catch(() => undefined);
  } finally {
    await releaseRunLock();
  }
}

const DUE_ALARM = "mybot-due";

// Wake near the earliest nextRunAt so a due round starts without waiting for the 1-min tick phase.
async function scheduleDueWake(groups, schedules) {
  const now = Date.now();
  let soonest = Infinity;
  for (const group of groups || []) {
    const fromLocal = schedules && schedules[group.id] ? Number(schedules[group.id]) : NaN;
    const fromServer = Date.parse(group.nextRunAt || "");
    // Prefer fresh local schedules from this cycle; fall back to server nextRunAt.
    const at = Number.isFinite(fromLocal) && fromLocal > now ? fromLocal : fromServer;
    if (Number.isFinite(at) && at > now && at < soonest) soonest = at;
  }
  await chrome.alarms.clear(DUE_ALARM).catch(() => undefined);
  if (!Number.isFinite(soonest) || soonest === Infinity) return;
  // Chrome MV3 may clamp delays under 1 minute; still align to the due instant when it is further out.
  await chrome.alarms.create(DUE_ALARM, { when: Math.max(soonest, now + 1000) }).catch(() => undefined);
}

const recentManual = new Map();

// ---- Quiet mode (settings on the MY-BOT site) ----
async function setQuiet(reason) {
  await chrome.storage.local.set({ quiet: reason ? { reason, at: Date.now() } : null }).catch(() => undefined);
}

function isFacebookTab(tab) {
  try {
    return /(^|\.)facebook\.com$/i.test(new URL(String(tab.url || "")).hostname);
  } catch {
    return false;
  }
}

async function quietReason(quiet) {
  if (!quiet) return "";
  if (quiet.window && globalThis.MyBotQuiet.inQuietWindow(quiet.window)) return "อยู่ในช่วงเวลาพัก";
  if (quiet.pauseWhenLocked && chrome.idle) {
    const state = await chrome.idle.queryState(60).catch(() => "active");
    if (state === "locked") return "หน้าจอล็อกอยู่";
  }
  if (quiet.pauseOnFacebook) {
    const win = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
    const usingOwnFb = win && win.focused && (win.tabs || []).some((tab) => tab.active && isFacebookTab(tab) && !scrapingTabs.has(tab.id));
    if (usingOwnFb) return "คุณกำลังใช้ Facebook อยู่";
  }
  return "";
}

async function forwardManual(message, sender) {
  // Pages opened by the background scrape report through scrapeGroup, not here.
  if (sender && sender.tab && (scrapingTabs.has(sender.tab.id) || isScrapeWindowTab(sender.tab))) return;
  const cfg = await loadConfig();
  if (cfg.paused || !cfg.token) return;
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
  if (cfg.paused || !cfg.token) return;
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

chrome.runtime.onInstalled.addListener((details) => {
  // 1.8.0: reading starts by itself once paired; the old opt-in switch is replaced by "paused".
  if (details && details.reason === "update") {
    void chrome.storage.local.get({ migrated180: false }).then((s) => {
      if (!s.migrated180) return chrome.storage.local.set({ paused: false, migrated180: true }).then(() => chrome.storage.local.remove(["enabled", "dedicatedWindow"]));
    }).catch(() => undefined);
  }
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
  if (alarm.name === "mybot-tick" || alarm.name === DUE_ALARM) void cycle();
  if (alarm.name === "mybot-tasks") void pollTasks();
  if (alarm.name === "mybot-tasks") {
    const deps = { loadConfig, postJson, currentFbUserId, base, waitComplete, sleep, rememberError };
    void globalThis.MyBotCommentWorker.recover(deps).then(() => globalThis.MyBotCommentWorker.run(deps));
  }
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
      .then(() => {
        sendResponse({ ok: true });
        void cycle();
      })
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
