importScripts("assist.js", "identity.js", "scrape.js", "quiet.js");
importScripts("focus.js", "tab-lifecycle.js", "browser-comment.js", "comment-worker.js");
importScripts("connect.js");

const DEFAULTS = {
  apiBase: "https://my-bot-e6bt.onrender.com",
  token: "",
  // Paired = reading starts on its own; "paused" is the owner's pause switch in the popup.
  paused: false,
  schedules: {},
  dedicatedReaderDesktop: false,
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
  const stored = await chrome.storage.local.get({ ...DEFAULTS, serverAccountControl: null, fbIdentity: null });
  const cfg = { ...DEFAULTS, ...stored, schedules: stored.schedules || {} };
  if (!validApiBase(cfg.apiBase)) return { ...cfg, apiBase: DEFAULTS.apiBase, token: "" };
  const control = stored.serverAccountControl;
  const identity = stored.fbIdentity;
  cfg.accountPaused = Boolean(control?.paused && control.apiBase === base(cfg) && control.fbUserId === identity?.id);
  return cfg;
}

// The MY-BOT page bridge for a custom HTTPS server the owner granted in the popup (*.onrender.com is in the manifest).
const CUSTOM_BRIDGE_ID = "mybot-bridge-custom";
async function syncCustomBridge() {
  await chrome.scripting.unregisterContentScripts({ ids: ["mybot-owner-server"] }).catch(() => undefined);
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
  if (url.protocol !== "https:") return;
  const pattern = `${url.origin}/*`;
  if (chrome.runtime.getManifest().content_scripts?.some(script => script.js.includes("bridge.js") && script.matches.includes(pattern))) return;
  if (!(await chrome.permissions.contains({ origins: [pattern] }))) return;
  await chrome.scripting
    .registerContentScripts([{ id: CUSTOM_BRIDGE_ID, matches: [pattern], js: ["bridge.js", "connect-page.js"], runAt: "document_start" }])
    .catch(() => undefined);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.apiBase) void syncCustomBridge();
});
chrome.permissions.onAdded.addListener(() => void syncCustomBridge());

function headers(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-extension-version": chrome.runtime.getManifest().version,
  };
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

function waitComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("แท็บกลุ่มโหลดไม่ทัน"));
    }, Math.max(1, timeoutMs));
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    // A parked reader is already complete and will not emit another onUpdated event.
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(error => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(error);
    });
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
    headers: { ...headers(cfg.token), "x-facebook-user-id": await currentFbUserId() },
    body: JSON.stringify(body),
  }, opts);
}

async function getJson(cfg, path, opts = { timeoutMs: 30000, retries: 1 }) {
  return fetchRetry(`${base(cfg)}${path}`, { headers: { ...headers(cfg.token), "x-facebook-user-id": await currentFbUserId() } }, opts);
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
const CAPTURE_JOURNAL_MAX = 400;
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
// Two at a time: three parallel background tabs often starve each other under Chrome throttling.
const PARALLEL_SCRAPE = 2;
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
async function loadCaptureJournal() {
  const stored = await chrome.storage.local.get({ captureJournal: [] });
  return (Array.isArray(stored.captureJournal) ? stored.captureJournal : []).filter(Boolean);
}
function mergeJournalPosts(existing, incoming) {
  const byUrl = new Map();
  for (const post of existing || []) if (post?.url) byUrl.set(String(post.url), post);
  for (const post of incoming || []) {
    if (!post?.url) continue;
    const prev = byUrl.get(String(post.url));
    if (!prev) { byUrl.set(String(post.url), post); continue; }
    const nextText = String(post.text || "");
    const prevText = String(prev.text || "");
    byUrl.set(String(post.url), nextText.length >= prevText.length ? { ...prev, ...post, text: nextText } : { ...post, ...prev, text: prevText });
  }
  return [...byUrl.values()].slice(0, 40);
}
/** Durable pre-outbox journal so visible-tab captures survive tab/Chrome restart before outbox admission. */
async function appendCaptureJournalUnlocked(item) {
  const journal = await loadCaptureJournal();
  const posts = (Array.isArray(item.posts) ? item.posts : []).filter((post) => post?.url && typeof post.text === "string").slice(0, 40);
  if (!posts.length) return { pending: journal.reduce((sum, row) => sum + (row.posts?.length || 0), 0), added: 0 };
  const apiBase = item.apiBase || null;
  const sourceUrl = item.sourceUrl;
  const fbUserId = item.fbUserId || null;
  const match = (row) => row && row.sourceUrl === sourceUrl && (row.apiBase || null) === apiBase && (row.fbUserId || null) === fbUserId;
  const idx = journal.findIndex(match);
  if (idx >= 0) {
    journal[idx] = { ...journal[idx], posts: mergeJournalPosts(journal[idx].posts, posts), at: Date.now() };
  } else {
    if (journal.length >= CAPTURE_JOURNAL_MAX) {
      const stats = await chrome.storage.local.get({ journalRejectedItems: 0 });
      await chrome.storage.local.set({ journalRejectedItems: (stats.journalRejectedItems || 0) + posts.length, captureJournalPending: journal.reduce((sum, row) => sum + (row.posts?.length || 0), 0) });
      await rememberError("สมุดจับภาพเต็ม หยุดรับเพิ่มจนกว่าจะส่งเข้าคิวได้");
      throw new Error("capture journal full");
    }
    journal.push({ id: outboxId(), sourceUrl, posts, fbUserId, apiBase, at: Date.now() });
  }
  const pending = journal.reduce((sum, row) => sum + (row.posts?.length || 0), 0);
  await chrome.storage.local.set({ captureJournal: journal, captureJournalPending: pending });
  return { pending, added: posts.length };
}
async function promoteCaptureJournalUnlocked() {
  let journal = await loadCaptureJournal();
  let outbox = await loadOutbox();
  if (!journal.length) {
    await chrome.storage.local.set({ captureJournalPending: 0, outboxBlocked: outbox.length >= OUTBOX_MAX });
    return { promoted: 0, remaining: 0, lastQueued: null };
  }
  const kept = [];
  let promoted = 0;
  let lastQueued = null;
  for (const entry of journal) {
    const posts = (Array.isArray(entry.posts) ? entry.posts : []).filter((post) => post?.url && typeof post.text === "string").slice(0, 40);
    if (!posts.length) continue;
    if (outbox.length >= OUTBOX_MAX) {
      kept.push({ ...entry, posts });
      continue;
    }
    const queued = {
      sourceUrl: entry.sourceUrl,
      posts: posts.map((post) => ({ ...post, itemId: post.itemId || outboxId() })),
      fbUserId: entry.fbUserId || null,
      apiBase: entry.apiBase || null,
      batchId: outboxId(),
      at: entry.at || Date.now(),
    };
    outbox.push(queued);
    lastQueued = queued;
    promoted += posts.length;
  }
  const remaining = kept.reduce((sum, row) => sum + (row.posts?.length || 0), 0);
  await chrome.storage.local.set({
    outbox,
    captureJournal: kept,
    captureJournalPending: remaining,
    outboxBlocked: outbox.length >= OUTBOX_MAX || remaining > 0,
  });
  return { promoted, remaining, lastQueued };
}
async function queueOutbox(item) {
  return withOutboxLock(async () => {
    await appendCaptureJournalUnlocked(item);
    const promoted = await promoteCaptureJournalUnlocked();
    if (promoted.lastQueued) return promoted.lastQueued;
    const stats = await chrome.storage.local.get({ outboxRejectedItems: 0 });
    await chrome.storage.local.set({ outboxBlocked: true, outboxRejectedItems: (stats.outboxRejectedItems || 0) + (item.posts?.length || 0) });
    await rememberError("คิวข้อมูลเต็ม เก็บไว้ในสมุดจับภาพแล้ว จะส่งต่อเมื่อมีช่องว่าง");
    // Journal write already durable — callers may acknowledge. Transport waits for promote.
    return { batchId: null, journalOnly: true, posts: item.posts, sourceUrl: item.sourceUrl, fbUserId: item.fbUserId || null, apiBase: item.apiBase || null, at: Date.now() };
  });
}
async function drainCaptureJournal() {
  return withOutboxLock(() => promoteCaptureJournalUnlocked());
}
let flushing = false;
async function flushOutbox(cfg, options = {}) {
  if (flushing || cfg.paused || cfg.accountPaused || !cfg.token) return;
  flushing = true;
  const results = {};
  const deadline = Math.min(Date.now() + 20_000, options.deadlineMs || Infinity);
  try {
    await drainCaptureJournal().catch(() => undefined);
    for (let sent = 0; sent < 10 && Date.now() < deadline; sent++) {
      const item = await withOutboxLock(async () => {
        const outbox = await loadOutbox();
        // Keep the total storage cap, but drain this server even if another server owns the head.
        await chrome.storage.local.set({ outboxBlocked: outbox.length >= OUTBOX_MAX });
        return outbox.find(entry => !entry.problem && (!entry.apiBase || entry.apiBase === base(cfg)));
      });
      if (!item) break;
      if (Date.now() - item.at >= OUTBOX_MAX_AGE_MS) {
        await withOutboxLock(async () => { const entries = await loadOutbox(); const match = entries.find(e => item.batchId ? e.batchId === item.batchId : e.at === item.at && e.sourceUrl === item.sourceUrl && e.apiBase === item.apiBase); if (match) match.problem = "expired"; await chrome.storage.local.set({ outbox: entries }); });
        await rememberError("ข้อมูลค้างเกิน 72 ชั่วโมง เก็บไว้ให้ตรวจเอง ไม่ลบทิ้งเงียบ ๆ"); continue;
      }
      const response = await postJson(cfg, "/api/v1/ingest", { ...(item.batchId ? { batchId: item.batchId } : {}), sourceUrl: item.sourceUrl, posts: item.posts, fbUserId: item.fbUserId || undefined }, { timeoutMs: Math.max(1, Math.min(15000, deadline - Date.now())), retries: 0 }).catch(() => null);
      if (!response || RETRY_STATUS.has(response.status) || response.status >= 500) break;
      if (response.status === 423) break; // Account paused: retain the complete batch for resume.
      if ([401, 403].includes(response.status)) { await rememberError("การเชื่อมต่อหมดสิทธิ์ ข้อมูลยังอยู่ในคิว กรุณาจับคู่ Extension ใหม่"); break; }
      const data = response.json ? await response.json().catch(() => ({})) : {};
      const ack = new Set(response.ok && data.batchId === item.batchId ? (data.receipts || []).filter(r => ["accepted", "skipped"].includes(r.outcome)).map(r => r.itemId) : []);
      if (response.ok && item.batchId && !ack.size) break; // old server: retain until upgraded
      await withOutboxLock(async () => {
        const entries = await loadOutbox();
        const index = entries.findIndex(entry => item.batchId ? entry.batchId === item.batchId : entry.at === item.at && entry.sourceUrl === item.sourceUrl && entry.apiBase === item.apiBase);
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

async function sendPosts(cfg, sourceUrl, posts, options = {}) {
  if (!posts.length) return null;
  const fbUserId = await currentFbUserId();
  const queued = await queueOutbox({ sourceUrl, posts, fbUserId, apiBase: base(cfg) });
  if (!queued?.batchId) {
    await flushOutbox(cfg, options).catch(() => undefined);
    return null;
  }
  const result = (await flushOutbox(cfg, options))?.[queued.batchId];
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
    const stored = await chrome.storage.local.get({
      fbIdentity: null,
      lastError: null,
      lastPostAt: 0,
      postsSent: 0,
      profileLabel: "",
      quiet: null,
      commentJournal: null,
      readingStatus: null,
      outboxRejectedItems: 0,
      journalRejectedItems: 0,
      fullTextOverflow: 0,
      captureJournalPending: 0,
    });
    await drainCaptureJournal().catch(() => undefined);
    const outbox = await loadOutbox();
    const journal = await loadCaptureJournal();
    const backlog = await loadFullTextBacklog();
    const readers = await chrome.storage.session.get({ readers: {} });
    const tabStatus = await botTabStatus();
    const fb = stored.fbIdentity || { loggedIn: false, id: "", name: "", at: 0 };
    const reading = stored.readingStatus && stored.readingStatus.groupName
      ? {
          groupId: String(stored.readingStatus.groupId || "").slice(0, 80),
          groupName: String(stored.readingStatus.groupName || "").slice(0, 120),
          phase: stored.readingStatus.phase === "detail" ? "detail" : stored.readingStatus.phase === "idle" ? "idle" : "feed",
          startedAt: Number(stored.readingStatus.startedAt) || 0,
        }
      : null;
    const outboxPending = outbox.reduce((sum, item) => sum + (item.posts?.length || 0), 0);
    const journalPending = journal.reduce((sum, item) => sum + (item.posts?.length || 0), 0);
    const outboxTimes = outbox.map((item) => Number(item.at) || Date.now());
    const journalTimes = journal.map((item) => Number(item.at) || Date.now());
    const pendingTimes = [...outboxTimes, ...journalTimes];
    const problemOutbox = outbox.filter((item) => item.problem).length;
    const fullTextReview = Object.values(backlog).filter((item) => item.problem).length;
    const fullTextActive = Object.values(backlog).filter((item) => !item.problem).length;
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
      runtime: {
        tabs: tabStatus,
        quietReason: stored.quiet?.reason || "",
        commentsEnabled: String(cfg.token).startsWith("mbd_") && !cfg.accountPaused,
        commentPending: Boolean(stored.commentJournal),
        reading,
        capture: {
          pendingPosts: outboxPending + journalPending,
          oldestPendingAt: pendingTimes.length ? Math.min(...pendingTimes) : 0,
          parkedFeeds: Object.values(readers.readers || {}).filter(reader => reader.continuation).length,
          journalPending,
          outboxRejectedItems: Number(stored.outboxRejectedItems) || 0,
          journalRejectedItems: Number(stored.journalRejectedItems) || 0,
          fullTextOverflow: Number(stored.fullTextOverflow) || 0,
          fullTextActive,
          fullTextReview,
          problemOutbox,
        },
      },
    }, { timeoutMs: 30000, retries: 1 });
    await chrome.storage.local.set({ lastHeartbeat: { at: Date.now(), status: response.status } });
    if (response.ok) {
      const status = await response.json().catch(() => ({}));
      await chrome.storage.local.set({ serverAccountControl: { apiBase: base(cfg), fbUserId: fb.id || "", paused: Boolean(status.accountPaused), at: Date.now() } });
      if (status.accountPaused) await setQuiet("บัญชีนี้ถูกหยุดงานจากหน้าจัดการบัญชี");
      if (!status.accountPaused && (outbox.length || journal.length)) await flushOutbox(await loadConfig());
    }
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
const activeReaderTabs = new Set();

async function executeReaderScript(details, timeoutMs = 5000) {
  let timer;
  try {
    return await Promise.race([
      chrome.scripting.executeScript(details),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("แท็บอ่านไม่ตอบภายในเวลาที่กำหนด จะเก็บสถานะไว้ลองต่อ")), Math.max(1, timeoutMs)); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function readPage(tabId, kind, timeoutMs = 5000) {
  const [executed] = await executeReaderScript({
    target: { tabId },
    args: [kind],
    func: (pageKind) => ({
      posts:
        pageKind === "marketplace"
          ? globalThis.MyBotParser.parseMarketplaceListings(document)
          : globalThis.MyBotParser.parseFacebookPosts(document),
      identity: globalThis.MyBotIdentity ? globalThis.MyBotIdentity.readFacebookIdentity(document) : null,
      groupId: pageKind === "marketplace" || !globalThis.MyBotParser.readGroupId ? "" : globalThis.MyBotParser.readGroupId(document),
      ...globalThis.MyBotScrape.feedStatus(document, pageKind),
      checkpoint: /^\/(checkpoint|challenge)(\/|$)/i.test(location.pathname) || Boolean(document.querySelector('form[action*="/checkpoint/"]')),
    }),
  }, timeoutMs);
  return executed && executed.result ? executed.result : { posts: [], identity: null, groupId: "" };
}

async function scrollOneScreen(tabId, kind = "group") {
  const [executed] = await executeReaderScript({
    target: { tabId },
    args: [kind],
    func: pageKind => {
      const page = globalThis.MyBotScrape.scrollRoot(document, pageKind);
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

async function reportRun(cfg, group, run, options = {}) {
  try {
    const response = await postJson(cfg, "/api/v1/extension/scrape-result", {
      sourceUrl: group.url,
      groupId: run.groupId || undefined,
      ok: run.ok,
      postsFound: Math.min(1000, run.postsFound),
      newPosts: Math.min(1000, run.newPosts),
      scrolls: Math.min(200, run.scrolls),
      stoppedBy: run.ok || ["logged_out", "checkpoint"].includes(run.stoppedBy) ? run.stoppedBy || "end" : "error",
      mode: run.mode,
      coverage: run.stats ? { ...run.stats, newCount: Math.min(1000, run.stats.newCount), stalls: Math.min(1000, run.stats.stalls) } : undefined,
      message: run.ok ? undefined : run.message,
    }, { timeoutMs: Math.max(1, Math.min(10000, (options.deadlineMs || Infinity) - Date.now())), retries: 0 });
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
  // Fail-closed: never discard recovery targets to satisfy the active cap.
  // Overflow becomes explicit review rows; only hard-drop expired/exhausted review past the bound.
  const previous = await chrome.storage.local.get({ fullTextOverflow: 0 });
  const active = Object.entries(backlog).filter(([, item]) => item && !item.problem)
    .sort((a, b) => (a[1].addedAt || 0) - (b[1].addedAt || 0));
  let overflowed = 0;
  if (active.length > 200) {
    for (const [, item] of active.slice(200)) {
      item.problem = "overflow_review";
      item.overflowAt = Date.now();
      overflowed += 1;
    }
  }
  const review = Object.entries(backlog).filter(([, item]) => item && item.problem)
    .sort((a, b) => (a[1].addedAt || 0) - (b[1].addedAt || 0));
  const keepReview = review.filter(([, item]) => !["expired", "retry_exhausted"].includes(item.problem));
  const droppable = review.filter(([, item]) => ["expired", "retry_exhausted"].includes(item.problem));
  const activeKept = Object.entries(backlog).filter(([, item]) => item && !item.problem);
  let kept = [...activeKept, ...keepReview];
  if (kept.length > 400) {
    // Prefer dropping only terminal review rows, never live recovery work.
    const overflowReview = keepReview.filter(([, item]) => item.problem === "overflow_review");
    const otherReview = keepReview.filter(([, item]) => item.problem !== "overflow_review");
    const room = Math.max(0, 400 - activeKept.length - otherReview.length);
    kept = [...activeKept, ...otherReview, ...overflowReview.slice(-room)];
    overflowed += Math.max(0, overflowReview.length - room);
  }
  // Terminal rows stay until space exists; count them as overflow pressure, do not silent-drop active URLs.
  if (droppable.length && kept.length >= 400) {
    overflowed += droppable.length;
  } else {
    kept = [...kept, ...droppable].slice(0, 400);
  }
  await chrome.storage.local.set({
    fullTextBacklog: Object.fromEntries(kept),
    fullTextOverflow: (previous.fullTextOverflow || 0) + overflowed,
    fullTextBlocked: activeKept.length >= 200 || kept.length >= 400,
  });
  if (overflowed) await rememberError("คิวอ่านข้อความเต็มเกินเพดาน — เก็บเป็นรายการตรวจ ไม่ทิ้งเงียบ ๆ กรุณาลดจำนวนกลุ่มหรือรอให้อ่านจบ");
}

async function updateFullTextBacklog(mutator) {
  return withBacklogLock(async () => {
    const backlog = await loadFullTextBacklog();
    const active = Object.values(backlog).filter((item) => item && !item.problem).length;
    const blocked = active >= 200 || Object.keys(backlog).length >= 400;
    await mutator(backlog, { blocked, active });
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
async function readFullTexts(tabId, kind, urls, options = {}) {
  const found = [];
  const failed = [];
  const tried = [];
  const failures = {};
  const deadline = Math.min(Date.now() + FULL_TEXT_BUDGET_MS, options.deadlineMs ?? Infinity);
  // Chrome work already accepted cannot be cancelled. Bound host waits and do not
  // start another operation after expiry; the caller retains durable recovery.
  const within = async (work, cap = Infinity) => {
    const remaining = Math.min(cap, deadline - Date.now());
    if (remaining <= 0) throw new Error("full-text budget exhausted");
    let timer;
    try {
      return await Promise.race([
        work(remaining),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("full-text budget exhausted")), remaining); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  for (const url of urls) {
    if (fullTextBudget <= 0 || Date.now() >= deadline) break;
    fullTextBudget -= 1;
    tried.push(url);
    try {
      if (options.openedUrl !== url || urls.length !== 1) await within(() => chrome.tabs.update(tabId, { url }));
      await within(ms => waitComplete(tabId, ms), 25000);
      await within(() => injectReaders(tabId, { deadlineMs: deadline }));
      const targetKey = postKey(url);
      let match = null;
      let reason = "target_not_found";
      // document.readyState=complete precedes React's post content. Poll the
      // exact target, never infer success from some other article on the page.
      for (let attempt = 0; attempt < 4 && Date.now() < deadline; attempt++) {
        const page = await within(ms => readPage(tabId, kind, ms), 5000);
        if (page.identity?.loggedIn === false) { reason = "facebook_logged_out"; break; }
        const target = targetKey ? (page.posts || []).find(post => postKey(post.url) === targetKey) : null;
        if (target && !target.truncated && String(target.text || "").trim()) { match = target; break; }
        reason = target ? "text_still_truncated" : "target_not_found";
        if (attempt < 3) await within(ms => sleep(ms), 1500);
      }
      if (match) found.push({ ...match, url });
      else { failed.push(url); failures[url] = reason; }
    } catch {
      failed.push(url); failures[url] = "navigation_or_parser_error"; // No send, retry later.
    }
  }
  return { found, failed, tried, failures };
}

// Poll synchronous snapshots using service-worker timers. Hidden pages can freeze their own
// setTimeout/MutationObserver completion even while synchronous DOM reads remain responsive.
async function waitForGrowth(tabId, kind, before, timeoutMs, knownKeys = []) {
  if (timeoutMs <= 0) return { count: before || 0, grew: false, height: 0 };
  const deadline = Date.now() + timeoutMs;
  let initialHeight = null;
  let grewAt = null;
  let snapshot = { count: before || 0, height: 0 };
  while (Date.now() < deadline) {
    const [executed] = await executeReaderScript({
      target: { tabId },
      injectImmediately: true,
      args: [kind, knownKeys],
      func: (pageKind, previousKeys) => {
        const selector = pageKind === "marketplace" ? 'a[href*="/marketplace/item/"]' : '[role="article"], [aria-posinset]';
        const feed = globalThis.MyBotScrape?.feedRoot(document, pageKind) || document;
        const page = globalThis.MyBotScrape?.scrollRoot(document, pageKind) || document.scrollingElement || document.documentElement;
        const known = new Set(previousKeys);
        return {
          count: feed.querySelectorAll(selector).length,
          height: page.scrollHeight,
          hasNewKey: known.size > 0 && Boolean(globalThis.MyBotScrape) &&
            [...feed.querySelectorAll(pageKind === "marketplace" ? selector : 'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="], a[href*="multi_permalinks="]')]
              .some(link => { const key = globalThis.MyBotScrape.postKey(link.href); return key && !known.has(key); }),
        };
      },
    }, Math.max(1, Math.min(5000, deadline - Date.now())));
    if (executed?.result) snapshot = executed.result;
    if (initialHeight === null) initialHeight = snapshot.height;
    const growing = snapshot.count > (before || 0) || snapshot.height > initialHeight + 200 || snapshot.hasNewKey;
    if (growing && grewAt === null) grewAt = Date.now();
    if (grewAt !== null && Date.now() - grewAt >= 350) break;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(350, remaining));
  }
  return { count: snapshot.count, grew: grewAt !== null, height: snapshot.height };
}

/** Activate only an owned, unfocused reader window. Never select a tab in the owner's window. */
async function activateIsolatedReader(reader) {
  return globalThis.MyBotFocus.withLock(async () => {
  if (await globalThis.MyBotFocus.blocked()) return false;
  if (!reader || reader.tabId === undefined) return false;
  const ref = await loadScrapeWindow();
  if (!ref || ref.host !== "reader" || ref.windowId !== reader.windowId) return false;
  const tab = await chrome.tabs.get(reader.tabId).catch(() => null);
  if (!tab || tab.windowId !== ref.windowId) return false;
  const win = await chrome.windows.get(ref.windowId, { populate: true }).catch(() => null);
  if (!isOwnedReaderWindow(win, ref)) return false;
  const { dedicatedReaderDesktop } = await chrome.storage.local.get({ dedicatedReaderDesktop: false });
  if (!dedicatedReaderDesktop && (win.focused || win.state === "minimized")) return false;
  // Explicit per-profile opt-in: only the owned collector window may take focus.
  if (dedicatedReaderDesktop) {
    await chrome.windows.update(win.id, { focused: true, ...(win.state === "minimized" ? { state: "normal" } : {}) });
  }
  await chrome.tabs.update(reader.tabId, { active: true }).catch(() => undefined);
  return true;
  });
}

async function wakeReaderTab(reader, holdMs) {
  if (await activateIsolatedReader(reader)) await sleep(Math.max(350, Number(holdMs) || 1400));
}

// Kept for legacy quiet-mode inputs; collection no longer restores/activates owner tabs.
let quietFacebookGraceUntil = 0;
async function withReaderForeground(reader, work) {
  await activateIsolatedReader(reader);
  return work();
}

// Lazy loading stalled: scroll up a little and back to the bottom so the feed asks for more (scrollTop only).
async function nudgeScroll(tabId, kind = "group", deadlineMs = Date.now() + 5000) {
  const remaining = () => {
    const ms = Math.min(5000, deadlineMs - Date.now());
    if (ms <= 0) throw new Error("หมดเวลากู้ฟีด เก็บตำแหน่งไว้รออ่านต่อ");
    return ms;
  };
  const firstBudget = remaining();
  const [snapshot] = await executeReaderScript({
    target: { tabId },
    args: [kind],
    func: pageKind => {
      const page = globalThis.MyBotScrape.scrollRoot(document, pageKind);
      const before = page.scrollTop;
      page.scrollTop = Math.max(0, before - 400);
      return { before, distance: Math.max(window.innerHeight || 0, 800) };
    },
  }, firstBudget);
  const position = snapshot?.result;
  if (!position || !Number.isFinite(position.before) || !Number.isFinite(position.distance)) return;
  // Page timers freeze in background Facebook tabs. Finish both relative scrolls
  // from the extension host so recovery does not stop after scrolling upward.
  await sleep(Math.min(300, remaining()));
  const secondBudget = remaining();
  await executeReaderScript({
    target: { tabId }, args: [kind, position],
    func: (pageKind, previous) => {
      globalThis.MyBotScrape.scrollRoot(document, pageKind).scrollTop = previous.before + previous.distance;
    },
  }, secondBudget);
}

const READER_FILES = ["selectors.js", "fbtime.js", "parser.js", "identity.js", "scrape.js"];

// Chrome sometimes fails the first executeScript with "Could not load file: 'selectors.js'"
// right after navigation or while the extension is reloading — retry a few times.
async function injectReaders(tabId, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = (options.deadlineMs ?? Infinity) - Date.now();
    if (remaining <= 0) break;
    try {
      await executeReaderScript({ target: { tabId }, files: READER_FILES }, Math.min(5000, remaining));
      return;
    } catch (err) {
      lastError = err;
      await sleep(Math.max(0, Math.min(350 * (attempt + 1), (options.deadlineMs ?? Infinity) - Date.now())));
    }
  }
  throw lastError || new Error("Could not inject readers");
}

// Collection owns a separate, unfocused normal window using the same Chrome profile.
// Never focus it, move personal tabs, or activate a reader in an owner window.
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
  const stored = await chrome.storage.session.get({ scrapeContainers: {} });
  const containers = { ...stored.scrapeContainers };
  if (ref && Number.isInteger(ref.tabId)) containers[String(ref.tabId)] = ref;
  else if (scrapeWindowRef) delete containers[String(scrapeWindowRef.tabId)];
  scrapeWindowRef = ref;
  await chrome.storage.session.set({ scrapeWindow: ref, scrapeContainers: containers });
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
    if (tab.windowId === undefined || scrapingTabs.has(tab.id) || (scrapeWindowRef && scrapeWindowRef.host === "reader" && tab.windowId === scrapeWindowRef.windowId)) continue;
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

// A user moving a personal tab here relinquishes exclusive tab activation rights.
function isOwnedReaderWindow(win, ref) {
  return Boolean(isNormalChromeWindow(win) && ref && ref.host === "reader" && win.id === ref.windowId &&
    (win.tabs || []).every(tab => isScrapeWindowTab(tab) || (tab.id === ref.tabId && tab.url === "about:blank")));
}

async function ensureScrapeWindow() {
  const ref = await loadScrapeWindow();
  if (ref?.closing) throw new Error("รอ Chrome ยืนยันการปิดหน้าต่างเก็บโพสต์ก่อน ข้อมูลค้างยังอยู่");
  const existing = ref && ref.host === "reader" ? await chrome.windows.get(ref.windowId, { populate: true }).catch(() => null) : null;
  if (isOwnedReaderWindow(existing, ref)) return ref;
  // Authentication cookies are shared within this Chrome profile; the owner's Facebook tab stays untouched.
  const ownerId = await findOwnerWindowId();
  if (ownerId === undefined) throw new Error("เปิด Facebook ใน Chrome ที่จับคู่ส่วนขยายไว้ก่อน");
  const win = await chrome.windows.create({ url: "about:blank", type: "normal", focused: false, state: "normal" });
  if (!isNormalChromeWindow(win)) throw new Error("ไม่สามารถเปิดหน้าต่างอ่านข้อมูล MY-BOT ได้");
  const next = { windowId: win.id, tabId: win.tabs && win.tabs[0] && win.tabs[0].id, usedAt: Date.now(), host: "reader" };
  await saveScrapeWindow(next);
  return next;
}

chrome.windows.onRemoved.addListener((windowId) => {
  void withScrapeWindowLock(async () => {
    const ref = await loadScrapeWindow();
    if (ref && ref.windowId === windowId) await saveScrapeWindow(null);
  }).catch(() => undefined);
  if (lastOwnerWindowId === windowId) lastOwnerWindowId = null;
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.windows.get(windowId).then((win) => {
    if (isNormalChromeWindow(win) && (!scrapeWindowRef || scrapeWindowRef.windowId !== windowId)) lastOwnerWindowId = windowId;
  }).catch(() => undefined);
});

async function closeOrphanReaders(options = {}) {
  const deadlineMs = Math.min(Date.now() + (options.budgetMs ?? 10000), options.deadlineMs ?? Infinity);
  return withScrapeWindowLock(async () => {
  const stored = await chrome.storage.session.get({ readers: {} });
  const readers = stored.readers || {};
  let changed = false;
  const cfg = await loadConfig();
  const fbUserId = await currentFbUserId();
  for (const [key, reader] of Object.entries(readers)) {
    if (Date.now() >= deadlineMs) break;
    if (activeReaderTabs.has(reader.tabId)) continue;
    const saved = reader.continuation;
    // The DOM cursor is useful only while we actually resume it. Durable recovery
    // and pending posts were saved before parking; do not leave abandoned tabs forever.
    const parkedExpired = saved && (options.parked || Date.now() - (reader.at || 0) >= 5 * 60_000);
    let ownershipChanged = false;
    // MV3 can restart while a feed is parked. Adopt the saved tab instead of closing it.
    if (!parkedExpired && !reader.closing && !cfg.paused && !cfg.accountPaused && saved && saved.apiBase === base(cfg) && saved.fbUserId === fbUserId) {
      const inspected = await globalThis.MyBotTabs.inspect(reader, sameReaderUrl, { deadlineMs });
      if (inspected.state === "owned") {
        scrapingTabs.add(reader.tabId);
        continue;
      }
      if (inspected.state === "retry") continue;
      ownershipChanged = true;
    }
    const orphan = parkedExpired || ownershipChanged || reader.closing || cfg.paused || cfg.accountPaused || reader.boot !== BOOT_ID ||
      (options.unused && !saved) || Date.now() - (reader.at || 0) > READER_MAX_AGE_MS;
    if (!orphan) continue;
    if (reader.closing && !globalThis.MyBotTabs.due(reader)) continue;
    // Never close the owner's Chrome window. Restore reused Facebook tabs; only remove tabs we created.
    const outcome = await releaseReaderTab(reader, { deadlineMs });
    if (outcome === "retry") { readers[key] = globalThis.MyBotTabs.retry(reader); changed = true; continue; }
    await globalThis.MyBotTabs.note(outcome);
    scrapingTabs.delete(reader.tabId);
    delete readers[key];
    changed = true;
  }
  if (changed) await chrome.storage.session.set({ readers });
  await closeIdleScrapeWindow(readers, { deadlineMs });
  });
}

// Open bot-owned tabs in the isolated collector window.
async function openReader(url, dedicated = false) {
  const reader = await withScrapeWindowLock(async () => {
    const stored = await chrome.storage.session.get({ readers: {} });
    const readers = stored.readers || {};
    if (Object.keys(readers).length >= 22) throw new Error("รอปิดแท็บบอทที่ค้างก่อนเปิดแท็บเพิ่ม ข้อมูลอ่านต่อยังอยู่");
    // Protect existing cursors until they finish. Overflow sources still get a head pass,
    // but release their temporary tab on yield instead of evicting every unfinished feed.
    const transient = dedicated && Object.values(readers).filter(item => (item.continuation || item.dedicated) && !item.transient).length >= 20;
    const ref = await ensureScrapeWindow();
    // Personal Facebook tabs are never borrowed or navigated.
    let tabId;
    let previousUrl = null;
    let ephemeral = true;
    if (url === "about:blank") {
      const tab = await chrome.tabs.create({ windowId: ref.windowId, url: "about:blank", active: false });
      tabId = tab.id;
    } else {
      const tab = await chrome.tabs.create({ windowId: ref.windowId, url, active: false });
      tabId = tab.id;
    }
    scrapingTabs.add(tabId);
    readers[String(tabId)] = { tabId, url, windowId: ref.windowId, boot: BOOT_ID, at: Date.now(), previousUrl, ephemeral, dedicated, transient };
    try { await chrome.storage.session.set({ readers }); }
    catch (error) {
      scrapingTabs.delete(tabId);
      await chrome.tabs.remove(tabId).catch(() => undefined);
      throw error;
    }
    activeReaderTabs.add(tabId); // Protect creation/navigation from concurrent cleanup.
    return { tabId, url, windowId: ref.windowId, ephemeral, previousUrl, transient, dedicated };
  });
  await sleep(400);
  return reader;
}

function sameReaderUrl(actual, expected) {
  try {
    const a = new URL(actual), b = new URL(expected);
    return a.origin === b.origin && a.pathname.replace(/\/+$/, "") === b.pathname.replace(/\/+$/, "") &&
      ["query", "minPrice", "maxPrice", "radius", "daysSinceListed", "exact"].every(key => a.searchParams.get(key) === b.searchParams.get(key));
  } catch { return false; }
}

function recoveryKey(cfg, group, fbUserId) {
  return JSON.stringify([base(cfg), fbUserId, group.url]);
}

async function loadContinuation(cfg, group, url, options = {}) {
  const fbUserId = await currentFbUserId();
  let invalidReader;
  // Resuming and cleanup share the same lock. Claim before releasing it, so a
  // popup/heartbeat cannot close the tab between lookup and active registration.
  const resumed = await withScrapeWindowLock(async () => {
    const stored = await chrome.storage.session.get({ readers: {} });
    for (const reader of Object.values(stored.readers || {})) {
      if (reader.closing) continue;
      const saved = reader.continuation;
      if (!saved || saved.sourceUrl !== group.url || saved.apiBase !== base(cfg) || saved.fbUserId !== fbUserId) continue;
      const inspected = await globalThis.MyBotTabs.inspect(reader, sameReaderUrl);
      if (inspected.state === "retry") throw new Error("Chrome ยังอ่านข้อมูลแท็บเดิมไม่ได้ เก็บตำแหน่งอ่านไว้รอลองใหม่");
      if (inspected.state !== "owned" || inspected.tab.discarded || !sameReaderUrl(inspected.tab.pendingUrl || inspected.tab.url, url)) {
        invalidReader = reader;
        return null;
      }
      const run = globalThis.MyBotScrape.restoreRun(saved.run);
      scrapingTabs.add(reader.tabId);
      if (options.claim) activeReaderTabs.add(reader.tabId);
      return { reader, run };
    }
    return null;
  });
  // closeReader takes this lock itself. Never nest it, and keep durable recovery.
  if (invalidReader) await closeReader(invalidReader);
  return resumed;
}

async function saveContinuation(cfg, group, reader, run) {
  const fbUserId = reader.fbUserId;
  // Persist a small recovery flag across a full Chrome restart; the DOM lives only in session.
  await withScrapeWindowLock(async () => {
    const local = await chrome.storage.local.get({ coverageRecovery: {} });
    const coverageRecovery = { ...local.coverageRecovery, [recoveryKey(cfg, group, fbUserId)]: { sourceUrl: group.url, apiBase: base(cfg), fbUserId, at: Date.now(), pending: run.fresh.map(cleanPost) } };
    await chrome.storage.local.set({ coverageRecovery });
    const stored = await chrome.storage.session.get({ readers: {} });
    const readers = { ...stored.readers };
    readers[String(reader.tabId)] = { ...reader, boot: BOOT_ID, at: Date.now(), continuation: {
      sourceUrl: group.url, url: globalThis.MyBotScrape.scrapeUrl(group.url, sourceKind(group)), apiBase: base(cfg), fbUserId,
      run: globalThis.MyBotScrape.snapshotRun(run),
    } };
    await chrome.storage.session.set({ readers });
  });
}

async function finishContinuation(group, cfg, fbUserId) {
  await withScrapeWindowLock(async () => {
    const stored = await chrome.storage.local.get({ coverageRecovery: {} });
    const coverageRecovery = { ...stored.coverageRecovery };
    delete coverageRecovery[recoveryKey(cfg, group, fbUserId)];
    await chrome.storage.local.set({ coverageRecovery });
  });
}

// Retain at most 20 parked feeds (active reads still use at most two tabs).
// Eviction leaves recovery flagged, so a new DOM pass never stops at known head posts.
async function pruneContinuations(cfg, groups) {
  const stored = await chrome.storage.session.get({ readers: {} });
  const valid = new Set((groups || []).map(group => group.url));
  const parked = Object.values(stored.readers || {}).filter(reader => reader.continuation).sort((a, b) => b.at - a.at);
  for (let index = 0; index < parked.length; index++) {
    const reader = parked[index];
    if (activeReaderTabs.has(reader.tabId)) continue;
    if (!valid.has(reader.continuation.sourceUrl) || reader.continuation.apiBase !== base(cfg) || index >= 20) await closeReader(reader);
  }
}

async function releaseReaderTab(reader, options = {}) {
  return globalThis.MyBotTabs.close(reader, (actual, expected) =>
    sameReaderUrl(actual, expected) || globalThis.MyBotTabs.samePostUrl(actual, expected), options);
}

async function closeIdleScrapeWindow(readers, options = {}) {
  const ref = await loadScrapeWindow();
  const stored = await chrome.storage.session.get({ scrapeContainers: {} });
  const containers = { ...stored.scrapeContainers };
  if (ref && !containers[String(ref.tabId)]) containers[String(ref.tabId)] = ref; // Existing sessions.
  for (const [key, container] of Object.entries(containers)) {
    if (Date.now() >= (options.deadlineMs ?? Infinity)) break;
    if (container.host !== "reader" || Object.values(readers).some(reader => reader.windowId === container.windowId)) continue;
    if (container.closing && !globalThis.MyBotTabs.due(container)) continue;
    // Only this registered blank tab, never the window or personal tabs in it.
    const outcome = await globalThis.MyBotTabs.close({ ...container, url: "about:blank", ephemeral: true }, () => false, options);
    if (outcome === "retry") containers[key] = globalThis.MyBotTabs.retry(container);
    else { delete containers[key]; await globalThis.MyBotTabs.note(outcome); }
  }
  scrapeWindowRef = ref ? containers[String(ref.tabId)] || null : null;
  await chrome.storage.session.set({ scrapeWindow: scrapeWindowRef, scrapeContainers: containers });
}

async function closeReader(reader) {
  if (!reader || reader.tabId === undefined) return;
  await withScrapeWindowLock(async () => {
    const stored = await chrome.storage.session.get({ readers: {} });
    const readers = stored.readers || {};
    const tracked = readers[String(reader.tabId)] || reader;
    if (tracked.closing && !globalThis.MyBotTabs.due(tracked)) return;
    const outcome = await releaseReaderTab(tracked);
    if (outcome === "retry") {
      readers[String(reader.tabId)] = globalThis.MyBotTabs.retry(tracked);
      await chrome.storage.session.set({ readers });
      return;
    }
    await globalThis.MyBotTabs.note(outcome);
    scrapingTabs.delete(reader.tabId);
    delete readers[String(reader.tabId)];
    await chrome.storage.session.set({ readers });
    await closeIdleScrapeWindow(readers);
  });
}

async function botTabStatus() {
  const stored = await chrome.storage.session.get({ readers: {}, commentTab: null, tabCleanup: {}, scrapeWindow: null, scrapeContainers: {} });
  return globalThis.MyBotTabs.summary(stored.readers, activeReaderTabs, stored.commentTab,
    globalThis.MyBotCommentWorker.isBusy(), stored.tabCleanup, Object.values(stored.scrapeContainers).length ? Object.values(stored.scrapeContainers) : [stored.scrapeWindow]);
}

async function cleanupBotTabs() {
  await closeOrphanReaders({ unused: true, parked: true });
  // Recovery only reports/reconciles; this path never claims, authorizes or sends.
  await globalThis.MyBotCommentWorker.recover({ loadConfig, base, postJson });
  return botTabStatus();
}

// Scroll and read one feed until the stop rule fires. Returns the run (see scrape.js).
// budgetMs: first pass stays short so a dead background tab can reload instead of burning ~90 s.
async function readFeed(reader, kind, plan, knownKeys, result, options = {}) {
  const Scrape = globalThis.MyBotScrape;
  const tabId = reader.tabId;
  const run = options.run || Scrape.createRun({ knownKeys, ...plan });
  Scrape.resumeRun(run);
  const sliceStart = run.steps;
  const checkpoint = options.checkpoint || (async () => undefined);
  const drain = options.drain || (async () => undefined);
  const feedDeadline = Math.min(Date.now() + Math.max(0, Number(options.budgetMs) || 40_000), options.deadlineMs || Infinity);
  const remaining = cap => Math.max(0, Math.min(cap, feedDeadline - Date.now()));
  const consume = async (page, step = true) => {
    if (page.checkpoint || page.identity?.loggedIn === false) {
      run.stoppedBy = page.checkpoint ? "checkpoint" : "logged_out";
      return run.stoppedBy;
    }
    if (options.fbUserId && page.identity?.id && page.identity.id !== options.fbUserId) throw new Error("บัญชี Facebook เปลี่ยนระหว่างอ่าน กรุณาเริ่มรอบใหม่");
    if (options.observe) options.observe(page.posts || []);
    const hasUnseen = (page.posts || []).some(post => { const key = Scrape.postKey(post.url); return key && !run.seen.has(key); });
    run.endSignals = page.endOfFeed && !page.loading ? (run.endSignals || 0) + 1 : 0;
    if (run.endSignals >= 2 && !hasUnseen) { run.stoppedBy = "exhausted"; await checkpoint(run); return run.stoppedBy; }
    if (!step && !hasUnseen) return run.stoppedBy;
    const before = run.newCount;
    const steps = run.steps;
    let reason = Scrape.addStep(run, page.posts);
    if (!step) run.steps = steps;
    run.stoppedBy = reason;
    if (run.newCount > before) run.recoveredEnd = false;
    // Save pending posts before outbox writes; crash between writes causes a safe duplicate, never a lost post.
    await checkpoint(run);
    await drain(run);
    if (reason === "cap") {
      run.stoppedBy = "";
      run.hitLimit = false;
      reason = "";
    }
    if (!reason && run.steps - sliceStart > plan.maxScrolls) { Scrape.yieldRun(run); reason = "limit"; }
    return reason;
  };
  const recoverEnd = async page => {
    if (!run.recoveredEnd) {
      if (remaining(5000) < 5000) { Scrape.yieldRun(run); return "limit"; }
      run.recoveredEnd = true;
      run.stoppedBy = "";
      run.emptySteps = 0;
      await wakeReaderTab(reader, 450);
      await nudgeScroll(tabId, kind, feedDeadline);
      await sleep(remaining(1200));
      state = await waitForGrowth(tabId, kind, state.count, remaining(3000), [...run.seen].slice(-1000));
      return consume(await readPage(tabId, kind), false);
    }
    if (page.loading || (run.found < Scrape.MIN_FOUND_BEFORE_END && !page.endOfFeed)) {
      const reason = page.loading ? "loading" : "stalled";
      Scrape.yieldRun(run, reason); return reason;
    }
    run.stoppedBy = "exhausted";
    return run.stoppedBy;
  };
  if (options.canRead && await options.canRead()) { Scrape.yieldRun(run, "yield"); await checkpoint(run); return run; }
  if (remaining(1) === 0) { Scrape.yieldRun(run); await checkpoint(run); return run; }
  await waitComplete(tabId, remaining(25000));
  await injectReaders(tabId);
  let state = await waitForGrowth(tabId, kind, 0, remaining(8000));
  if (!state.count) {
    run.stalls += 1;
    if (remaining(1500)) await sleep(remaining(1500));
    state = await waitForGrowth(tabId, kind, 0, remaining(5000));
  }
  let first = await readPage(tabId, kind);
  if (first.identity) await rememberIdentity(first.identity);
  if (first.groupId) result.groupId = first.groupId;
  result.sample = (first.posts || []).slice(0, 8);
  let stop = await consume(first);
  // First paint often shows 0–1 articles. Wait once more before treating that as the whole feed.
  if (!stop && (first.posts || []).length < 2 && remaining(4000)) {
    run.stalls += 1;
    await sleep(remaining(1200));
    state = await waitForGrowth(tabId, kind, state.count || 0, remaining(4000));
    first = await readPage(tabId, kind);
    stop = await consume(first, false);
  }
  if (stop === "end") stop = await recoverEnd(first);
  const keepAwake = Boolean(options.keepAwake);
  const holdForeground = Boolean(options.holdForeground);
  const pulseWake = typeof options.pulseWake === "function" ? options.pulseWake : null;
  while (!stop && Date.now() < feedDeadline) {
    const pause = options.canRead ? await options.canRead() : "";
    if (pause) { stop = "yield"; Scrape.yieldRun(run, stop); break; }
    // Dead feed: stop early so scrapeGroup can wake + reload instead of idling to the deadline.
    // Catchup/sweep/audit tolerate more stalls before aborting (see shouldAbortDeadFeed).
    if (Scrape.shouldAbortDeadFeed(run)) {
      stop = "stalled";
      run.stoppedBy = stop;
      run.hitLimit = true;
      break;
    }
    if (pulseWake && Scrape.shouldPulseWake({ keepAwake, holdForeground, found: run.found, steps: run.steps })) {
      await pulseWake();
    }
    const before = state.count;
    const previousKeys = new Set(run.seen);
    await scrollOneScreen(tabId, kind);
    await sleep(remaining(Scrape.scrollWaitMs(undefined, { growing: run.found >= 3 })));
    if (Date.now() >= feedDeadline) break;
    state = await waitForGrowth(tabId, kind, before, remaining(run.found >= 3 ? 2200 : 3000), [...run.seen].slice(-1000));
    const immediate = await readPage(tabId, kind);
    if ((immediate.posts || []).some(post => { const key = Scrape.postKey(post.url); return key && !previousKeys.has(key); })) state.grew = true;
    // Virtualized feeds may replace the entire snapshot during the following wait.
    stop = await consume(immediate);
    if (stop && stop !== "end") break;
    for (let retry = 0; !state.grew && retry < 1 && remaining(1) > 0; retry += 1) {
      run.stalls += 1;
      await nudgeScroll(tabId, kind, feedDeadline);
      state = await waitForGrowth(tabId, kind, before, remaining(2500), [...run.seen].slice(-1000));
    }
    if (!state.grew || stop === "end") {
      const page = await readPage(tabId, kind);
      // A second DOM read is not a second scroll/no-progress attempt.
      if (page.checkpoint || page.identity?.loggedIn === false || page.posts?.some(post => !run.seen.has(Scrape.postKey(post.url)))) {
        stop = await consume(page, false);
      }
      if (stop === "end") stop = await recoverEnd(page);
    }
  }
  if (!stop && Date.now() >= feedDeadline) Scrape.yieldRun(run);
  await checkpoint(run);
  return run;
}

function cleanPost(post) {
  const Scrape = globalThis.MyBotScrape;
  return { url: post.url, authorName: post.authorName || "", text: Scrape.cleanupText(post.text), postedAt: post.postedAt || null, images: post.images || [] };
}

async function setReadingStatus(status) {
  await chrome.storage.local.set({ readingStatus: status || null }).catch(() => undefined);
}

// Head checks have their own pending captures; never overwrite the historical DOM checkpoint.
async function saveHeadPending(cfg, group, fbUserId, posts) {
  await withScrapeWindowLock(async () => {
    const stored = await chrome.storage.local.get({ headRecovery: {} });
    const headRecovery = { ...stored.headRecovery };
    const key = recoveryKey(cfg, group, fbUserId);
    if (posts.length) headRecovery[key] = { pending: posts.map(cleanPost) };
    else delete headRecovery[key];
    await chrome.storage.local.set({ headRecovery });
  });
}

async function noteHeadCheck(cfg, group, fbUserId, at) {
  await withScrapeWindowLock(async () => {
    const stored = await chrome.storage.local.get({ headChecks: {} });
    await chrome.storage.local.set({ headChecks: { ...stored.headChecks, [recoveryKey(cfg, group, fbUserId)]: at } });
  });
}

async function scrapeGroup(cfg, group, remote, options = {}) {
  // One group's total budget stays 45 seconds. Latest and history run sequentially,
  // so a head check cannot exceed the existing active-reader ceiling.
  const started = Date.now();
  const deadlineMs = Math.min(options.deadlineMs || Infinity, started + 45_000);
  const fbUserId = await currentFbUserId();
  const key = recoveryKey(cfg, group, fbUserId);
  const stored = await chrome.storage.local.get({ headChecks: {} });
  const continuation = await loadContinuation(cfg, group, globalThis.MyBotScrape.scrapeUrl(group.url, sourceKind(group)));
  let head = null;
  const latest = await loadConfig();
  if (options.freshness !== false && continuation && !latest.paused && !latest.accountPaused &&
      latest.token === cfg.token && base(latest) === base(cfg) && !await quietReason(remote?.quiet) &&
      started - (stored.headChecks[key] || 0) >= 60_000 && deadlineMs - Date.now() >= 35_000) {
    head = await scrapeGroupPass(cfg, group, remote, { ...options, head: true, deadlineMs: Math.min(deadlineMs - 25_000, Date.now() + 20_000) });
    // Failed/blocked checks retry after a short cooldown, not a tight tab-opening loop.
    await noteHeadCheck(cfg, group, fbUserId, head.ok && !["loading", "stalled", "yield"].includes(head.stoppedBy) ? Date.now() : Date.now() - 45_000);
    if (!head.ok) return { ...head, nextRunAt: Date.now() + 60_000 };
  }
  const result = await scrapeGroupPass(cfg, group, remote, { ...options, deadlineMs, headResult: head });
  if (!continuation && result.ok && result.postsFound > 0) await noteHeadCheck(cfg, group, fbUserId, started);
  if (head) {
    result.latestCheck = { postsFound: head.postsFound, newPosts: head.newPosts, stoppedBy: head.stoppedBy };
  }
  return result;
}

async function scrapeGroupPass(cfg, group, remote, options) {

  options = options || {};
  const Scrape = globalThis.MyBotScrape;
  const kind = sourceKind(group);
  const settings = await scrapeSettingsFor(remote);
  const stored = await chrome.storage.local.get({ sweeps: {}, sweepBoostUntil: {}, coverageRecovery: {}, headRecovery: {} });
  const fbUserId = await currentFbUserId();
  const recovery = options.head ? stored.headRecovery?.[recoveryKey(cfg, group, fbUserId)] : stored.coverageRecovery?.[recoveryKey(cfg, group, fbUserId)];
  const recovering = options.head ? Boolean(recovery) : recovery && recovery.apiBase === base(cfg) && recovery.fbUserId === fbUserId;
  let plan = Scrape.planRun({
    group: { ...group, needsCoverage: group.needsCoverage || recovering },
    settings,
    lastSweepAt: (stored.sweeps || {})[group.id],
    sweepBoostUntil: (stored.sweepBoostUntil || {})[group.id],
    audit: Boolean(options && options.audit),
  });
  if (options.head) plan = { ...plan, mode: "latest", maxScrolls: 2, knownStreak: Infinity };
  const result = { ok: true, postsFound: 0, newPosts: 0, scrolls: 0, stoppedBy: "", message: "", nextRunAt: null, mode: plan.mode, stats: null };
  const startedAt = Date.now();
  const deadlineMs = Math.min(options.deadlineMs || Infinity, startedAt + 45_000);
  const feedDeadlineMs = deadlineMs - (options.head ? 4000 : 10_000);
  let reader;
  let run;
  let retain = false;
  let recycleStalled = false;
  const batchIds = [];
  const observed = new Set();
  const observe = posts => { for (const post of posts) { const key = Scrape.postKey(post.url); if (key) observed.add(key); } };
  await setReadingStatus({
    groupId: group.id || "",
    groupName: group.name || group.url || "",
    phase: "feed",
    startedAt,
  });
  void heartbeat();
  try {
    const url = Scrape.scrapeUrl(group.url, kind);
    const continuation = options.head ? null : await loadContinuation(cfg, group, url, { claim: true });
    reader = continuation?.reader || await openReader(url, !options.head);
    activeReaderTabs.add(reader.tabId);
    reader.fbUserId = fbUserId;
    run = continuation?.run || Scrape.createRun({ knownKeys: group.knownKeys || [], ...plan });
    if (!continuation && recovering && recovery.pending?.length) {
      run.fresh = recovery.pending;
      for (const post of run.fresh) run.seen.add(Scrape.postKey(post.url));
      run.found = run.seen.size;
      run.newCount = run.fresh.length;
    }
    // Recover latest captures even if its temporary tab disappeared or history finished.
    const pendingHead = !options.head && stored.headRecovery?.[recoveryKey(cfg, group, fbUserId)]?.pending;
    if (pendingHead?.length) {
      const pendingKeys = new Set(run.fresh.map(post => Scrape.postKey(post.url)));
      for (const post of pendingHead) {
        const key = Scrape.postKey(post.url);
        if (!pendingKeys.has(key)) { run.fresh.push(post); pendingKeys.add(key); }
        run.seen.add(key);
      }
      run.found = run.seen.size;
    }
    if (Scrape.isDeepMode(plan.mode)) { run.knownStreak = Infinity; run.mode = plan.mode; }
    run.maxScrolls = plan.maxScrolls;
    run.maxPosts = plan.maxPosts;
    run.maxAgeMs = plan.maxAgeMs;
    const startCounters = { found: run.found, fresh: run.newCount, steps: run.steps, stalls: run.stalls };
    const checkpoint = current => options.head ? saveHeadPending(cfg, group, fbUserId, current.fresh) : saveContinuation(cfg, group, reader, current);
    const drain = async (current, force = false) => {
      const batchSize = Math.min(40, plan.maxPosts);
      if (!force && current.fresh.length < plan.maxPosts) return;
      while (current.fresh.length && (force || current.fresh.length >= batchSize)) {
        const picked = current.fresh.slice(0, batchSize);
        const queued = await queueOutbox({ sourceUrl: group.url, posts: picked.map(cleanPost), fbUserId, apiBase: base(cfg) });
        if (queued?.batchId) batchIds.push(queued.batchId);
        if (kind !== "marketplace") await updateFullTextBacklog(async (backlog, state) => {
          for (const post of picked) {
            if (!post.truncated || backlog[post.url]) continue;
            if (state?.blocked) {
              backlog[post.url] = { groupId: group.id, sourceUrl: group.url, tries: 0, addedAt: Date.now(), after: 0, problem: "overflow_review", overflowAt: Date.now() };
              continue;
            }
            backlog[post.url] = { groupId: group.id, sourceUrl: group.url, tries: 0, addedAt: Date.now(), after: 0 };
          }
        });
        current.fresh.splice(0, picked.length);
        await checkpoint(current);
      }
    };
    // Recover pending posts if MV3 stopped after the checkpoint but before the outbox write.
    await checkpoint(run);
    if (pendingHead?.length) await saveHeadPending(cfg, group, fbUserId, []);
    await drain(run, true);
    const win = reader.windowId !== undefined ? await chrome.windows.get(reader.windowId).catch(() => null) : null;
    const reading = { windowState: readerWindowState(win), reloaded: false, stallsFirst: 0, stallsRetry: 0, throttled: false, heldForeground: false };
    const holdFg = options.head || Scrape.shouldHoldForeground(plan, group);
    const knownKeys = group.knownKeys || [];
    const canRead = async () => {
      const latest = await loadConfig();
      const blocked = await chrome.storage.local.get({ outboxBlocked: false });
      if (await globalThis.MyBotFocus.blocked()) return "กำลังส่งคอมเมนต์ — พักการอ่านชั่วคราว";
      if (latest.paused || latest.accountPaused || latest.token !== cfg.token || base(latest) !== base(cfg) || blocked.outboxBlocked) return "paused";
      return quietReason(remote?.quiet);
    };
    const runPass = (pass, hold, current) => {
      const exec = () =>
        readFeed(reader, kind, plan, knownKeys, result, {
          budgetMs: Math.min(Scrape.feedBudgetMs(plan, pass), Math.max(1, feedDeadlineMs - Date.now())),
          deadlineMs: feedDeadlineMs,
          keepAwake: hold,
          holdForeground: hold,
          // Pulse only when we are not already holding the tab in the foreground.
          pulseWake: hold ? null : () => wakeReaderTab(reader, 450),
          run: current, checkpoint, drain, canRead, fbUserId, observe,
        });
      return hold ? withReaderForeground(reader, exec) : exec();
    };
    // Deep / coverage: hold the reader in the foreground for the whole pass so Facebook hydrates.
    reading.heldForeground = holdFg;
    run = await runPass(1, holdFg, run);
    reading.stallsFirst = run.stalls || 0;
    const needsRetry =
      !options.head && ["stalled", "loading"].includes(run.stoppedBy) && run.newCount === startCounters.fresh;
    if (needsRetry && feedDeadlineMs - Date.now() >= 12_000 && !await canRead()) {
      reading.reloaded = true;
      reading.heldForeground = true;
      // Shallow recovery always holds foreground for reload + pass 2 (hydrate beats pulse).
      const again = await withReaderForeground(reader, async () => {
        await chrome.tabs.reload(reader.tabId).catch(() => undefined);
        await sleep(Scrape.postWakeSettleMs(plan, 2));
        return readFeed(reader, kind, { ...plan, knownStreak: Infinity }, [...new Set([...knownKeys, ...run.seen])], result, {
          budgetMs: Math.min(Scrape.feedBudgetMs(plan, 2), Math.max(1, feedDeadlineMs - Date.now())),
          deadlineMs: feedDeadlineMs,
          keepAwake: true,
          holdForeground: true,
          pulseWake: null,
          checkpoint, drain, canRead, fbUserId, observe,
        });
      });
      reading.stallsRetry = again.stalls || 0;
      again.stalls += run.stalls;
      again.seen = new Set([...run.seen, ...again.seen]);
      again.found = again.seen.size;
      again.newCount += run.newCount;
      again.steps += run.steps;
      run = again;
      await checkpoint(run);
      if (["stalled", "loading"].includes(run.stoppedBy)) {
        reading.throttled = true;
        await chrome.storage.local.set({ throttledAt: Date.now() }).catch(() => undefined);
      }
    }
    await drain(run, true);
    const stats = { ...Scrape.runStats(run), newCount: run.newCount - startCounters.fresh, scrolls: Math.max(0, run.steps - startCounters.steps - 1), stalls: Math.max(0, run.stalls - startCounters.stalls) };
    result.stats = { ...stats, usedWindow: false, ...reading, fullTried: 0, fullOk: 0, durationMs: 0, extVersion: chrome.runtime.getManifest().version };
    result.scrolls = stats.scrolls;
    result.stoppedBy = run.stoppedBy || "end";
    result.postsFound = observed.size || Math.max(0, run.found - startCounters.found);
    const latest = await loadConfig();
    const flushed = !latest.paused && !latest.accountPaused && latest.token === cfg.token && base(latest) === base(cfg) ? await flushOutbox(latest, { deadlineMs: deadlineMs - 5000 }) : {};
    result.newPosts = batchIds.reduce((sum, id) => sum + (Number(flushed?.[id]?.inserted) || 0), 0);
    retain = run.hitLimit || ["limit", "cap", "yield", "stalled", "loading"].includes(run.stoppedBy);
    const noProgress = retain && ["stalled", "loading", "limit"].includes(run.stoppedBy) && run.found <= startCounters.found;
    reader.stalledSlices = noProgress ? (reader.stalledSlices || 0) + 1 : 0;
    recycleStalled = !options.head && noProgress && reader.stalledSlices >= 3;
    if (!options.head && retain) await checkpoint(run); // Keep recovery even when the DOM is recycled.
    if (!options.head && !retain && ["end", "exhausted", "seen", "old"].includes(run.stoppedBy)) {
      await finishContinuation(group, cfg, fbUserId);
      if (plan.mode !== "normal") await noteSweepAt(group.id);
    }
    if (["logged_out", "checkpoint"].includes(run.stoppedBy)) {
      result.ok = false;
      result.message = run.stoppedBy === "checkpoint" ? "Facebook ขอให้เจ้าของตรวจสอบบัญชีใน Chrome" : "กรุณาเข้าสู่ระบบ Facebook ใหม่";
      await rememberError(result.message);
    }
    if (!options.head && kind !== "marketplace") {
      // Discovery only enqueues work under a lock so parallel groups do not clobber each other.
      await updateFullTextBacklog(async (backlog, state) => {
        const now = Date.now();
        const urls = [...new Set((group.refetchUrls || []).map(String))];
        for (const url of urls) {
          if (backlog[url]) continue;
          backlog[url] = state?.blocked
            ? { groupId: group.id, sourceUrl: group.url, tries: 0, addedAt: now, after: 0, problem: "overflow_review", overflowAt: now }
            : { groupId: group.id, sourceUrl: group.url, tries: 0, addedAt: now, after: 0 };
        }
      });
    }
    if (deadlineMs - Date.now() > 8000) await postJson(cfg, "/api/v1/extension/sample", { sourceUrl: group.url, posts: result.sample || [] }, { timeoutMs: Math.min(3000, deadlineMs - Date.now() - 5000), retries: 0 }).catch(() => undefined);
    if (result.ok) result.message = `อ่านเพิ่ม ${result.postsFound} โพสต์ เก็บใหม่ ${stats.newCount} · เลื่อน ${result.scrolls} หน้าจอ (${plan.mode})${recycleStalled ? " · คืนแท็บที่ไม่คืบหน้า เก็บคิวกู้คืนไว้แล้ว" : retain ? " · รออ่านต่อจากเดิม" : ""}`;
  } catch (error) {
    const message = String(error && error.message ? error.message : error).slice(0, 300);
    await rememberError(`อ่าน ${kind === "marketplace" ? "Marketplace" : "กลุ่ม"} ${group.name || group.url} ไม่สำเร็จ: ${message}`).catch(() => undefined);
    Object.assign(result, { ok: false, message });
    retain = Boolean(reader && run);
  } finally {
    if (reader) activeReaderTabs.delete(reader.tabId);
    if (options.head || !retain || recycleStalled || reader?.transient) await closeReader(reader);
    await setReadingStatus(null);
  }
  delete result.sample;
  if (result.stats) result.stats.durationMs = Date.now() - startedAt;
  if (options.headResult) {
    result.newPosts += options.headResult.newPosts;
    result.message += ` · ตรวจโพสต์ล่าสุด เก็บใหม่ ${options.headResult.newPosts}`;
  }
  // A short latest check is not a coverage report and must not reset server coverage/scheduling.
  if (options.head) return result;
  result.nextRunAt = await reportRun(cfg, group, result, { deadlineMs });
  if (retain && result.ok && ["limit", "cap", "yield"].includes(result.stoppedBy)) result.nextRunAt = Date.now() + 30_000;
  if (retain && result.ok && ["loading", "stalled"].includes(result.stoppedBy)) result.nextRunAt = Date.now() + 60_000;
  // Incomplete coverage → accelerate the next deep sweep for this source.
  if (result.ok && ["cap", "limit", "screens", "loading", "stalled", "yield"].includes(String(result.stoppedBy || ""))) {
    await withSweepsLock(async () => {
      const stored = await chrome.storage.local.get({ sweepBoostUntil: {} });
      const boost = { ...(stored.sweepBoostUntil || {}) };
      boost[group.id] = Date.now() + 2 * 3600_000;
      await chrome.storage.local.set({ sweepBoostUntil: boost });
    }).catch(() => undefined);
  }
  return result;
}
async function processFullTextQueue(cfg, groups, options = {}) {
  const metrics = { at: Date.now(), tried: 0, succeeded: 0, failed: 0, remaining: 0, durationMs: 0 };
  const detailDeadline = Math.min(Date.now() + (options.budgetMs ?? 60_000), options.deadlineMs ?? Infinity);
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
    const latest = await loadConfig(); if (latest.paused || latest.accountPaused || latest.token !== cfg.token || base(latest) !== base(cfg)) break;
    used.set(group.id, (used.get(group.id) || 0) + 1);
    let reader;
    try {
      reader = await openReader(url);
      activeReaderTabs.add(reader.tabId);
      metrics.tried += 1;
      await updateFullTextBacklog(async (backlog) => {
        if (!backlog[url]) return;
        backlog[url].lastTriedAt = Date.now();
      });
      const read = await readFullTexts(reader.tabId, sourceKind(group), [url], { deadlineMs: detailDeadline, openedUrl: url });
      // Enqueue durably BEFORE removing recovery. A storage failure must keep the
      // target retryable; a network timeout leaves the complete text in outbox.
      if (read.found.length) await sendPosts(cfg, group.url, read.found.map(cleanPost), { deadlineMs: detailDeadline });
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
    } catch {
      metrics.failed += 1;
      await updateFullTextBacklog(async (backlog) => {
        if (!backlog[url]) return;
        backlog[url].tries = (backlog[url].tries || 0) + 1;
        backlog[url].after = Date.now() + 5 * 60_000;
      });
    } finally { if (reader) activeReaderTabs.delete(reader.tabId); await closeReader(reader); }
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
  if (cycling) return;
  const cfg = await loadConfig();
  if (cfg.paused || cfg.accountPaused || !cfg.token) return;
  if ((await chrome.storage.local.get({ outboxBlocked: false })).outboxBlocked) {
    await flushOutbox(cfg);
    if ((await chrome.storage.local.get({ outboxBlocked: false })).outboxBlocked) return;
  }
  // Facebook logged out (seen in the last 30 min): wait; a later cycle probes again.
  await probeFacebookIdentity();
  const fbState = await chrome.storage.local.get({ fbIdentity: null });
  const fb = fbState.fbIdentity;
  if (fb && fb.loggedIn === false && Date.now() - (fb.at || 0) < 30 * 60 * 1000) return void (await setQuiet("ยังไม่ได้เข้าสู่ระบบ Facebook"));
  if (fb && fb.loggedIn) await setQuiet("");
  if (!(await takeRunLock("cycle"))) return;
  try {
    const started = Date.now();
    const cycleDeadline = started + 3 * 60_000;
    await closeOrphanReaders({ unused: true, deadlineMs: cycleDeadline });
    const response = await getJson(cfg, "/api/v1/extension-config");
    if (!response.ok) return;
    const remote = await response.json();
    if (remote.accountPaused) {
      await chrome.storage.local.set({ serverAccountControl: { apiBase: base(cfg), fbUserId: await currentFbUserId(), paused: true, at: Date.now() } });
      await setQuiet(remote.message || "บัญชีนี้ถูกหยุดงานจากหน้าจัดการบัญชี");
      return;
    }
    if (remote.upgradeRequired || remote.scrapeAllowed === false) {
      await setQuiet(`ต้องอัปเดตส่วนขยายเป็น ${remote.expectedVersion || "เวอร์ชันล่าสุด"}`);
      await rememberError(remote.message || `ส่วนขยายเวอร์ชันนี้ถูกระงับการอ่าน — ใช้ ${remote.expectedVersion || "เวอร์ชันล่าสุด"}`).catch(() => undefined);
      return;
    }
    const reason = await quietReason(remote.quiet);
    await setQuiet(reason);
    if (reason) return;
    await pruneContinuations(cfg, remote.groups || []);
    const now = Date.now();
    const schedules = { ...cfg.schedules };
    // Local nextRunAt / in-flight lock always wins — prevents re-scraping every tick when server due is stale.
    const INFLIGHT_MS = 2 * 60 * 1000;
    const Scrape = globalThis.MyBotScrape;
    const { throttledAt, cycleCursor } = await chrome.storage.local.get({ throttledAt: 0, cycleCursor: "" });
    const { coverageRecovery } = await chrome.storage.local.get({ coverageRecovery: {} });
    const fbUserId = await currentFbUserId();
    const throttle = Scrape.throttleLevel(throttledAt, now);
    const due = Scrape.orderDueGroups(
      (remote.groups || []).map(group => {
        const saved = coverageRecovery[recoveryKey(cfg, group, fbUserId)];
        const needsCoverage = group.needsCoverage || (saved && saved.apiBase === base(cfg) && saved.fbUserId === fbUserId);
        return { ...group, needsCoverage: Boolean(needsCoverage) };
      }).filter((group) => {
        if (remote.serverScheduling && group.due === false && !group.needsCoverage) return false;
        const until = schedules[group.id] || 0;
        if (until > now) return false;
        return true;
      }),
      { cursorId: cycleCursor, now },
    );
    // Soften the old "2 groups for 30 minutes" cap — hard/soft windows + round-robin.
    const needsCoverageDue = due.some((group) => group.needsCoverage);
    const limit = remote.maxGroupsPerCycle || 20;
    const batch = due.slice(0, Scrape.cycleBatchLimit({ limit, throttleLevel: throttle, needsCoverageDue, throttledAt, now }));
    const parallel = Scrape.cycleParallel({
      throttleLevel: throttle,
      recentlyThrottled: throttle === "hard",
      batch,
      defaultParallel: PARALLEL_SCRAPE,
    });
    // Full-text must not steal tabs before discovery when many groups are due or Chrome is throttling.
    if (throttle === "none" && batch.length <= 2 && Object.keys(await loadFullTextBacklog()).length >= 10) {
      await processFullTextQueue(cfg, remote.groups || [], { budgetMs: 15000, maxItems: 2, deadlineMs: cycleDeadline });
    }
    for (const group of batch) schedules[group.id] = started + INFLIGHT_MS;
    await chrome.storage.local.set({ schedules });
    // Up to PARALLEL_SCRAPE tabs at once (1 while throttled/coverage), staggered; remaining due groups wait for the next wake.
    const settled = await mapPool(batch, parallel, async (group, index) => {
      if (cycleDeadline - Date.now() < 15_000) return { group, result: { ok: false, message: "yield", nextRunAt: Date.now() + 1000, skipped: true } };
      if (index > 0) await sleep(1200 * Math.min(index, Math.max(1, parallel)));
      if (await quietReason(remote.quiet)) return { group, result: { ok: false, message: "quiet", nextRunAt: Date.now() + 60_000 } };
      const result = await scrapeGroup(cfg, group, remote, { deadlineMs: Math.min(cycleDeadline, Date.now() + 45_000) });
      return { group, result };
    });
    for (const { group, result } of settled) {
      if (!result) continue;
      const interval = group.currentIntervalMinutes || group.intervalMinutes || remote.defaultIntervalMinutes || 10;
      schedules[group.id] = result.nextRunAt
        ? Math.min(result.nextRunAt, Date.now() + 180 * 60 * 1000)
        : Date.now() + interval * 60 * 1000;
    }
    const lastDone = [...settled].reverse().find((row) => row && row.group && row.group.id && !row.result?.skipped);
    await chrome.storage.local.set({
      schedules,
      ...(lastDone ? { cycleCursor: lastDone.group.id } : {}),
      readingStatus: null,
    });
    await pruneContinuations(cfg, remote.groups || []);
    // Detail reads run after discovery with a smaller budget when Chrome just throttled.
    if (Date.now() < cycleDeadline && !await quietReason(remote.quiet)) {
      await setReadingStatus({ groupId: "", groupName: "อ่านข้อความเต็ม", phase: "detail", startedAt: Date.now() });
      void heartbeat();
      await processFullTextQueue(cfg, remote.groups || [], {
        deadlineMs: cycleDeadline,
        budgetMs: throttle === "hard" ? 20_000 : throttle === "soft" ? 40_000 : 60_000,
        maxItems: throttle === "hard" ? 4 : throttle === "soft" ? 7 : 10,
      });
      await setReadingStatus(null);
    }
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
    const at = Number.isFinite(fromLocal) ? fromLocal : fromServer;
    if (Number.isFinite(at) && at < soonest) soonest = Math.max(at, now + 1000);
    else if (!Number.isFinite(at)) soonest = Math.min(soonest, now + 1000);
  }
  await chrome.alarms.clear(DUE_ALARM).catch(() => undefined);
  if (!Number.isFinite(soonest) || soonest === Infinity) return;
  // Chrome MV3 may clamp delays under 1 minute; still align to the due instant when it is further out.
  await chrome.alarms.create(DUE_ALARM, { when: Math.max(soonest, now + 1000) }).catch(() => undefined);
}

const recentManual = new Map();
let manualTail = Promise.resolve();

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
    const active = win && win.focused ? (win.tabs || []).find((tab) => tab.active) : null;
    if (
      active &&
      globalThis.MyBotQuiet.shouldPauseForFacebook({
        pauseOnFacebook: true,
        activeTabUrl: active.url || "",
        activeTabId: active.id,
        scrapingTabIds: scrapingTabs,
        graceUntil: quietFacebookGraceUntil,
        now: Date.now(),
      })
    ) {
      return "คุณกำลังดูฟีด/ข้อความ Facebook";
    }
  }
  return "";
}

async function forwardManual(message, sender) {
  // Pages opened by the background scrape report through scrapeGroup, not here.
  if (sender && sender.tab && (scrapingTabs.has(sender.tab.id) || isScrapeWindowTab(sender.tab))) return { accepted: false, managedReader: true };
  const cfg = await loadConfig();
  if (cfg.paused || cfg.accountPaused || !cfg.token) return { accepted: false, retryAfterMs: 15000 };
  const fbUserId = await currentFbUserId();
  // Per-post dedupe, never a per-source time gate: two posts a second apart must both survive.
  const work = manualTail.then(async () => {
    const rows = (message.posts || []).slice(0, 40).filter(post => post?.url && post.text).map(post => ({ post,
      key: JSON.stringify([base(cfg), cfg.token, fbUserId, message.sourceUrl, globalThis.MyBotScrape.postKey(post.url)]),
      fingerprint: JSON.stringify([post.text, post.images || []]),
    }));
    const fresh = rows.filter(row => recentManual.get(row.key)?.fingerprint !== row.fingerprint);
    if (fresh.length) {
      await queueOutbox({ sourceUrl: message.sourceUrl, posts: fresh.map(row => row.post), fbUserId, apiBase: base(cfg) });
      // Mark only after storage succeeds. Failed writes remain retryable.
      for (const row of fresh) recentManual.set(row.key, { fingerprint: row.fingerprint, at: Date.now() });
      for (const [key, row] of recentManual) if (Date.now() - row.at > 5 * 60_000) recentManual.delete(key);
      while (recentManual.size > 1000) recentManual.delete(recentManual.keys().next().value);
    }
    return { accepted: true, queued: fresh.length };
  });
  manualTail = work.catch(() => undefined);
  const result = await work;
  // Durable receipt is immediate; transport has its own bounded, restart-safe outbox.
  const latest = await loadConfig();
  if (!latest.paused && !latest.accountPaused && latest.token === cfg.token && base(latest) === base(cfg)) void flushOutbox(latest).catch(() => undefined);
  return result;
}

async function pollTasks() {
  if (cycling) return;
  const cfg = await loadConfig();
  if (cfg.paused || cfg.accountPaused || !cfg.token) return;
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

function armAlarms(existing = []) {
  for (const [name, periodInMinutes] of [["mybot-tick", 1], ["mybot-tasks", 0.5], ["mybot-heartbeat", 1]]) {
    if (!existing.some(alarm => alarm.name === name && alarm.periodInMinutes === periodInMinutes)) {
      void chrome.alarms.create(name, { periodInMinutes }).catch(() => undefined);
    }
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  void globalThis.MyBotConnect.installed(details, { loadConfig, base, syncCustomBridge }).catch(() => undefined);
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
    void globalThis.MyBotCommentWorker.drain(deps).catch(() => undefined);
  }
  if (alarm.name === "mybot-heartbeat") {
    void heartbeat();
    void closeOrphanReaders({ unused: true }).catch(() => undefined);
  }
});

// A fresh service worker (after Chrome stopped the old one) closes readers the old one left open
// and makes sure the alarms exist.
void closeOrphanReaders().catch(() => undefined);
void chrome.alarms.getAll().then(alarms => armAlarms(alarms)).catch(() => undefined);

async function handleTabLifecycleMessage(message, sender) {
  if (sender.url !== chrome.runtime.getURL("popup.html") || !["bot-tabs-status", "bot-tabs-cleanup"].includes(message?.type)) return null;
  const tabs = message.type === "bot-tabs-cleanup" ? await cleanupBotTabs() : await botTabStatus();
  return { ok: true, tabs };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["bot-tabs-status", "bot-tabs-cleanup"].includes(message?.type)) return;
  handleTabLifecycleMessage(message, sender).then(result => sendResponse(result || { ok: false }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "extension-connect-open" && sender.url === chrome.runtime.getURL("popup.html")) {
    globalThis.MyBotConnect.open({ loadConfig, base }).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (!["extension-connect-begin", "extension-connect-complete", "extension-connect-cancel"].includes(message?.type)) return;
  globalThis.MyBotConnect.handle(message, sender, { loadConfig, base, ready: async () => { await heartbeat(); void cycle(); } })
    .then(sendResponse).catch(() => sendResponse({ ok: false, error: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง" }));
  return true;
});

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
  if (message?.type === "clear-comment-journal" && sender.url === chrome.runtime.getURL("popup.html")) {
    loadConfig()
      .then(async cfg => {
        if (!String(cfg.token || "").startsWith("mbd_")) throw new Error("ต้องจับคู่อุปกรณ์ก่อนปลดล็อก");
        const stored = await chrome.storage.local.get({ commentJournal: null });
        const journal = stored.commentJournal;
        const response = await postJson(cfg, "/api/v1/extension/comments", {
          action: "clear_journal",
          ...(journal?.id ? { jobId: journal.id } : {}),
          ownerOutcome: ["confirmed_sent", "confirmed_not_sent", "still_uncertain", "reviewed"].includes(message.ownerOutcome)
            ? message.ownerOutcome
            : "reviewed",
          ...(message.note ? { note: String(message.note).slice(0, 300) } : {}),
        }, { timeoutMs: 10000, retries: 0 });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.ok !== true) throw new Error(body.error || (body.upgradeRequired ? `อัปเดตส่วนขยายเป็น ${body.expectedVersion}` : "เซิร์ฟเวอร์ไม่รับการปลดล็อก"));
        sendResponse({ ok: true, jobId: body.jobId || null, ownerOutcome: body.ownerOutcome || "reviewed" });
      })
      .catch(error => sendResponse({ ok: false, error: error?.message || "ปลดล็อกไม่สำเร็จ" }));
    return true;
  }
  if (message?.type !== "manual-posts") return;
  forwardManual(message, sender)
    .then(result => sendResponse({ ok: true, ...result }))
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
