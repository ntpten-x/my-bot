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

async function postJson(cfg, path, body) {
  return fetch(`${base(cfg)}${path}`, {
    method: "POST",
    headers: headers(cfg.token),
    body: JSON.stringify(body),
  });
}

// ---- Status for the "ภาพรวมระบบ" page (read-only facts about this browser) ----
async function installId() {
  const stored = await chrome.storage.local.get({ installId: "" });
  if (stored.installId) return stored.installId;
  const id = (crypto.randomUUID ? crypto.randomUUID() : `ext-${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64);
  await chrome.storage.local.set({ installId: id });
  return id;
}

async function rememberError(message) {
  await chrome.storage.local.set({ lastError: { message: String(message || "").slice(0, 300), at: Date.now() } });
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
  const fbUserId = await currentFbUserId();
  const response = await postJson(cfg, "/api/v1/ingest", { sourceUrl, posts, fbUserId: fbUserId || undefined });
  if (response && response.ok) {
    if (posts.length) await chrome.storage.local.set({ lastPostAt: Date.now() });
    const stored = await chrome.storage.local.get({ postsSent: 0 });
    await chrome.storage.local.set({ postsSent: (stored.postsSent || 0) + posts.length });
  } else if (response) {
    const data = await response.json().catch(() => ({}));
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
    });
    await chrome.storage.local.set({ lastHeartbeat: { at: Date.now(), status: response.status } });
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
      stoppedBy: run.ok ? run.stoppedBy || "screens" : "error",
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

async function scrapeGroup(cfg, group, remote) {
  const Scrape = globalThis.MyBotScrape;
  const kind = sourceKind(group);
  const settings = await scrapeSettingsFor(remote);
  const run = Scrape.createRun({ knownKeys: group.knownKeys || [], maxAgeMs: settings.maxAgeMs, maxPosts: settings.maxPosts });
  const result = { ok: true, postsFound: 0, newPosts: 0, scrolls: 0, stoppedBy: "", message: "", nextRunAt: null };
  let tabId;
  let sample = [];
  try {
    const tab = await chrome.tabs.create({ url: Scrape.scrapeUrl(group.url, kind), active: false });
    tabId = tab.id;
    scrapingTabs.add(tabId);
    await waitComplete(tabId);
    await sleep(2500);
    await chrome.scripting.executeScript({ target: { tabId }, files: ["selectors.js", "fbtime.js", "parser.js", "identity.js"] });
    const first = await readPage(tabId, kind);
    if (first.identity) await rememberIdentity(first.identity);
    if (first.groupId) result.groupId = first.groupId;
    sample = (first.posts || []).slice(0, 8);
    let stop = Scrape.addStep(run, first.posts);
    while (!stop && result.scrolls < settings.screens) {
      const moved = await scrollOneScreen(tabId);
      result.scrolls += 1;
      await sleep(Scrape.scrollWaitMs());
      const page = await readPage(tabId, kind);
      stop = Scrape.addStep(run, page.posts);
      if (!stop && !moved.moved) stop = Scrape.addStep(run, []);
    }
    result.stoppedBy = run.stoppedBy || "screens";
    result.postsFound = run.found;
    const picked = run.fresh.slice(0, settings.maxPosts);
    const fresh = picked.map((post) => ({
      url: post.url,
      authorName: post.authorName || "",
      text: Scrape.cleanupText(post.text),
      postedAt: post.postedAt || null,
      images: post.images || [],
    }));
    if (fresh.length) {
      const response = await sendPosts(cfg, group.url, fresh);
      const data = response && response.ok ? await response.clone().json().catch(() => ({})) : {};
      result.newPosts = Number(data.inserted) || 0;
    }
    if (kind !== "marketplace") {
      const cut = [...picked.filter((post) => post.truncated).map((post) => post.url), ...(group.refetchUrls || [])];
      const urls = [...new Set(cut.map(String))];
      if (urls.length) {
        const full = await readFullTexts(tabId, kind, urls);
        if (full.length) {
          await sendPosts(cfg, group.url, full.map((post) => ({
            url: post.url,
            authorName: post.authorName || "",
            text: Scrape.cleanupText(post.text),
            postedAt: post.postedAt || null,
            images: post.images || [],
          }))).catch(() => undefined);
          result.fullTexts = full.length;
        }
      }
    }
    await postJson(cfg, "/api/v1/extension/sample", { sourceUrl: group.url, posts: sample }).catch(() => undefined);
    result.message = `อ่านได้ ${run.found} โพสต์ ใหม่ ${result.newPosts} · เลื่อน ${result.scrolls} หน้าจอ`;
  } catch (error) {
    const message = String(error && error.message ? error.message : error).slice(0, 300);
    await rememberError(`อ่าน ${kind === "marketplace" ? "Marketplace" : "กลุ่ม"} ${group.name || group.url} ไม่สำเร็จ: ${message}`).catch(() => undefined);
    Object.assign(result, { ok: false, message, postsFound: run.found });
  } finally {
    if (tabId) {
      await chrome.tabs.remove(tabId).catch(() => undefined);
      scrapingTabs.delete(tabId);
    }
  }
  result.nextRunAt = await reportRun(cfg, group, result);
  return result;
}

let cycling = false;
const RUN_LOCK_MS = 3 * 60 * 1000;

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
  } catch {
    // เปิดแอปไม่ติดหรือเน็ตหลุด — รอรอบถัดไป
  } finally {
    cycling = false;
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
  cycling = true;
  try {
    const response = await fetch(`${base(cfg)}/api/v1/extension/tasks`, { headers: headers(cfg.token) });
    if (!response.ok) return;
    const data = await response.json();
    for (const task of data.tasks || []) {
      const result = await scrapeGroup(cfg, task, null);
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
  chrome.alarms.create("mybot-heartbeat", { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  armAlarms();
  void heartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  armAlarms();
  void heartbeat();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "mybot-tick") void cycle();
  if (alarm.name === "mybot-tasks") void pollTasks();
  if (alarm.name === "mybot-heartbeat") void heartbeat();
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
    const response = await fetch(`${base(cfg)}/api/v1/extension/reply-queue`, { method: "POST", headers: headers(cfg.token), body: JSON.stringify(body) });
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
