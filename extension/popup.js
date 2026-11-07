const DEFAULT_BASE = "http://localhost:8001";
const apiBase = document.getElementById("apiBase");
const token = document.getElementById("token");
const code = document.getElementById("code");
const enabled = document.getElementById("enabled");
const browserComments = document.getElementById("browserComments");
chrome.storage.local.get({ browserCommentsEnabled: false }, cfg => { browserComments.checked = cfg.browserCommentsEnabled; });
browserComments.addEventListener("change", async () => {
  await chrome.storage.local.set({ browserCommentsEnabled: browserComments.checked });
  chrome.runtime.sendMessage({ type: "heartbeat-now" }, () => void chrome.runtime.lastError);
});
document.getElementById("clearCommentJournal").addEventListener("click", async () => {
  if (!confirm("ตรวจผลบน Facebook และประวัติงานแล้วใช่ไหม? งานเดิมจะไม่ส่งซ้ำ ปุ่มนี้ล้างเฉพาะตัวล็อกบนเครื่อง ไม่ล้างประวัติเซิร์ฟเวอร์")) return;
  await chrome.storage.local.remove("commentJournal");
  status.textContent = "ปลดล็อกบนเครื่องแล้ว ตรวจและบันทึกกฎที่พักไว้บนเว็บก่อน Start ใหม่";
});
const status = document.getElementById("status");
const pairState = document.getElementById("pairState");
document.getElementById("version").textContent = "v" + chrome.runtime.getManifest().version;

// Token only goes to the local app over http, or to an HTTPS server.
function normalizeBase(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "") || DEFAULT_BASE;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: "ที่อยู่ไม่ถูกต้อง" };
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) return { base: url.origin };
  return { error: "ต้องเป็น https:// (หรือ http://localhost สำหรับเครื่องนี้)" };
}

function needsOptionalPermission(base) {
  const url = new URL(base);
  return url.protocol === "https:" && url.hostname !== "my-bot-e6bt.onrender.com";
}

function showPairState(cfg) {
  const paired = String(cfg.token || "").startsWith("mbd_");
  pairState.innerHTML = "";
  const pill = document.createElement("span");
  pill.className = paired ? "pill ok" : "pill";
  pill.textContent = paired ? "จับคู่แล้ว · " + cfg.apiBase : cfg.token ? "ใช้โทเคนแบบเดิม" : "ยังไม่ได้จับคู่";
  pairState.appendChild(pill);
}

chrome.storage.local.get({ apiBase: DEFAULT_BASE, token: "", paused: false, quiet: null }, (cfg) => {
  apiBase.value = cfg.apiBase;
  token.value = String(cfg.token || "").startsWith("mbd_") ? "" : cfg.token;
  enabled.checked = !cfg.paused;
  showPairState(cfg);
  if (cfg.quiet && cfg.quiet.reason && Date.now() - cfg.quiet.at < 5 * 60 * 1000) status.textContent = "พักชั่วคราว: " + cfg.quiet.reason;
});

async function ensurePermission(base) {
  if (!needsOptionalPermission(base)) return true;
  const allowed = await chrome.permissions.request({ origins: [base + "/*"] });
  if (allowed) {
    await chrome.scripting.unregisterContentScripts({ ids: ["mybot-owner-server"] }).catch(() => undefined);
    await chrome.scripting.registerContentScripts([{ id: "mybot-owner-server", matches: [base + "/*"], js: ["bridge.js"], runAt: "document_start" }]);
  }
  return allowed;
}

document.getElementById("pair").addEventListener("click", async () => {
  const parsed = normalizeBase(apiBase.value);
  if (parsed.error) return void (status.textContent = parsed.error);
  const pairing = code.value.trim();
  if (!/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(pairing)) return void (status.textContent = "ใส่รหัสจับคู่ 8 ตัว เช่น ABCD-EFGH");
  if (!(await ensurePermission(parsed.base))) return void (status.textContent = "ต้องอนุญาตให้ส่วนขยายเชื่อมต่อเซิร์ฟเวอร์นี้ก่อน");
  status.textContent = "กำลังจับคู่…";
  try {
    const response = await fetch(parsed.base + "/api/v1/extension/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pairing, name: "Chrome " + navigator.platform }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token) return void (status.textContent = data.error || "จับคู่ไม่สำเร็จ (HTTP " + response.status + ")");
    enabled.checked = true; // paired: start reading automatically (read-only)
    const cfg = { apiBase: parsed.base, token: data.token, paused: false };
    await chrome.storage.local.set(cfg);
    code.value = "";
    token.value = "";
    showPairState(cfg);
    status.textContent = "จับคู่สำเร็จ";
    chrome.runtime.sendMessage({ type: "heartbeat-now" }, () => void chrome.runtime.lastError);
  } catch (error) {
    status.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: " + (error && error.message ? error.message : "network");
  }
});

document.getElementById("save").addEventListener("click", async () => {
  const parsed = normalizeBase(apiBase.value);
  if (parsed.error) return void (status.textContent = parsed.error);
  if (!(await ensurePermission(parsed.base))) return void (status.textContent = "ต้องอนุญาตให้ส่วนขยายเชื่อมต่อเซิร์ฟเวอร์นี้ก่อน");
  const stored = await chrome.storage.local.get({ apiBase: DEFAULT_BASE, token: "" });
  const legacy = token.value.trim();
  // Changing server drops a device token issued by the old one.
  let nextToken = legacy || (stored.apiBase === parsed.base ? stored.token : "");
  if (legacy && parsed.base !== DEFAULT_BASE && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(parsed.base)) {
    nextToken = stored.apiBase === parsed.base ? stored.token : "";
    status.textContent = "โทเคนแบบเดิมใช้ได้เฉพาะ localhost — กรุณาจับคู่ด้วยรหัสแทน";
  }
  const cfg = { apiBase: parsed.base, token: nextToken, paused: !enabled.checked };
  await chrome.storage.local.set(cfg);
  showPairState(cfg);
  if (!status.textContent.startsWith("โทเคนแบบเดิม")) status.textContent = "บันทึกแล้ว";
  chrome.runtime.sendMessage({ type: "heartbeat-now" }, () => void chrome.runtime.lastError);
});

async function showOutbox() {
  const { outbox = [], outboxRejectedItems = 0 } = await chrome.storage.local.get({ outbox: [], outboxRejectedItems: 0 });
  document.getElementById("outboxStatus").textContent = `คิวข้อมูล ${outbox.length} ชุด · ต้องตรวจ ${outbox.filter(item => item.problem).length} ชุด · ไม่รับเพิ่มเพราะเต็ม ${outboxRejectedItems} รายการ`;
}
document.getElementById("clearOutboxProblems").addEventListener("click", async () => {
  if (!confirm("ยืนยันว่าตรวจรายการหมดอายุ/ถูกปฏิเสธแล้ว และยอมรับการลบข้อมูลเฉพาะรายการเหล่านี้?")) return;
  const { outbox = [] } = await chrome.storage.local.get({ outbox: [] });
  await chrome.storage.local.set({ outbox: outbox.filter(item => !item.problem), outboxBlocked: false });
  await showOutbox();
});
void showOutbox();
