importScripts("assist.js");

const DEFAULTS = {
  apiBase: "http://localhost:8001",
  token: "",
  enabled: false,
  schedules: {},
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadConfig() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored, schedules: stored.schedules || {} };
}

function headers(token) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function base(cfg) {
  return String(cfg.apiBase || DEFAULTS.apiBase).replace(/\/$/, "");
}

function chronoUrl(url) {
  const parsed = new URL(url);
  if (!parsed.searchParams.get("sorting_setting")) parsed.searchParams.set("sorting_setting", "CHRONOLOGICAL");
  return parsed.href;
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

async function postJson(cfg, path, body) {
  await fetch(`${base(cfg)}${path}`, {
    method: "POST",
    headers: headers(cfg.token),
    body: JSON.stringify(body),
  });
}

async function scrapeGroup(cfg, group) {
  let tabId;
  try {
    const tab = await chrome.tabs.create({ url: chronoUrl(group.url), active: false });
    tabId = tab.id;
    await waitComplete(tabId);
    await sleep(2500);
    await chrome.scripting.executeScript({ target: { tabId }, files: ["selectors.js", "parser.js"] });
    const [executed] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.MyBotParser.parseFacebookPosts(document),
    });
    const posts = executed?.result || [];
    await postJson(cfg, "/api/v1/ingest", { sourceUrl: group.url, posts });
    await postJson(cfg, "/api/v1/extension/sample", { sourceUrl: group.url, posts: (posts || []).slice(0, 8) }).catch(() => undefined);
    return { ok: true, postsFound: posts.length, message: `อ่านได้ ${posts.length} โพสต์` };
  } catch (error) {
    await postJson(cfg, "/api/v1/fetch-log", {
      sourceUrl: group.url,
      status: "error",
      message: String(error && error.message ? error.message : error).slice(0, 300),
    }).catch(() => undefined);
    return { ok: false, postsFound: 0, message: String(error && error.message ? error.message : error).slice(0, 300) };
  } finally {
    if (tabId) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

let cycling = false;

async function cycle() {
  if (cycling) return;
  const cfg = await loadConfig();
  if (!cfg.enabled || !cfg.token) return;
  cycling = true;
  try {
    const response = await fetch(`${base(cfg)}/api/v1/extension-config`, { headers: headers(cfg.token) });
    if (!response.ok) return;
    const remote = await response.json();
    const now = Date.now();
    const schedules = { ...cfg.schedules };
    const due = (remote.groups || []).filter((group) => !schedules[group.id] || now >= schedules[group.id]);
    const batch = due.slice(0, remote.maxGroupsPerCycle || 3);
    for (const group of batch) {
      await scrapeGroup(cfg, group);
      const interval = group.intervalMinutes || remote.defaultIntervalMinutes || 10;
      const jitter = Math.random() * (remote.jitterMinutes ?? 5);
      schedules[group.id] = Date.now() + (interval + jitter) * 60 * 1000;
      await chrome.storage.local.set({ schedules });
      await sleep(4000 + Math.random() * 6000);
    }
  } catch {
    // เปิดแอปไม่ติดหรือเน็ตหลุด — รอรอบถัดไป
  } finally {
    cycling = false;
  }
}

const recentManual = new Map();

async function forwardManual(message) {
  const cfg = await loadConfig();
  if (!cfg.token) return;
  const key = message.sourceUrl;
  const last = recentManual.get(key) || 0;
  if (Date.now() - last < 20000) return;
  recentManual.set(key, Date.now());
  await postJson(cfg, "/api/v1/ingest", { sourceUrl: message.sourceUrl, posts: message.posts || [] });
  await postJson(cfg, "/api/v1/extension/sample", {
    sourceUrl: message.sourceUrl,
    posts: (message.posts || []).slice(0, 8),
  }).catch(() => undefined);
}

async function pollTasks() {
  if (cycling) return;
  const cfg = await loadConfig();
  if (!cfg.token) return;
  cycling = true;
  try {
    const response = await fetch(`${base(cfg)}/api/v1/extension/tasks`, { headers: headers(cfg.token) });
    if (!response.ok) return;
    const data = await response.json();
    for (const task of data.tasks || []) {
      const result = await scrapeGroup(cfg, task);
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
    cycling = false;
  }
}

function armAlarms() {
  chrome.alarms.create("mybot-tick", { periodInMinutes: 1 });
  chrome.alarms.create("mybot-tasks", { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(() => {
  armAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  armAlarms();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "mybot-tick") void cycle();
  if (alarm.name === "mybot-tasks") void pollTasks();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "manual-posts") return;
  forwardManual(message)
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
});

// ---- Assisted reply (owner-triggered only; the owner presses send in Facebook) ----
const ASSIST_TTL_MS = 3 * 60 * 1000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

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

async function loadPendingAssist() {
  const stored = await chrome.storage.session.get({ pendingAssist: [] });
  return (stored.pendingAssist || []).filter((entry) => Date.now() - entry.at < ASSIST_TTL_MS);
}

async function acceptAssist(message, sender) {
  const cfg = await loadConfig();
  const assist = globalThis.MyBotAssist;
  if (!sender.tab || !sender.url || !fromMyBotApp(sender.url, base(cfg))) return { ok: false, error: "คำขอไม่ได้มาจากหน้า MY-BOT" };
  if (!assist.isFacebookUrl(message.url)) return { ok: false, error: "ลิงก์นี้ไม่ใช่โพสต์ Facebook" };
  const text = String(message.text || "").slice(0, assist.MAX_TEXT).trim();
  if (!text) return { ok: false, error: "ไม่มีข้อความ" };
  const pending = (await loadPendingAssist()).slice(-4);
  pending.push({ id: message.nonce || String(Date.now()), key: assist.postKey(message.url), openerTabId: sender.tab.id, text, at: Date.now() });
  await chrome.storage.session.set({ pendingAssist: pending });
  return { ok: true };
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url) return;
  const assist = globalThis.MyBotAssist;
  if (!assist.isFacebookUrl(tab.url)) return;
  void (async () => {
    const pending = await loadPendingAssist();
    const key = assist.postKey(tab.url);
    // Exact post match, or the tab MY-BOT itself just opened (Facebook sometimes rewrites post URLs).
    const index = pending.findIndex(
      (entry) => (entry.key && entry.key === key) || (tab.openerTabId !== undefined && tab.openerTabId === entry.openerTabId && Date.now() - entry.at < 30000),
    );
    if (index < 0) return;
    const [entry] = pending.splice(index, 1);
    await chrome.storage.session.set({ pendingAssist: pending });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["assist.js"] });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (text) => globalThis.MyBotAssist.runAssist(text),
      args: [entry.text],
    });
  })().catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "assist-reply") return;
  acceptAssist(message, sender)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: "ส่วนขยายรับคำขอไม่ได้" }));
  return true;
});
