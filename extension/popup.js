const DEFAULT_BASE = "https://my-bot-e6bt.onrender.com";
const apiBase = document.getElementById("apiBase");
const token = document.getElementById("token");
const code = document.getElementById("code");
document.getElementById("connectAuto").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "extension-connect-open" }, result => {
    void chrome.runtime.lastError;
    if (!result?.ok) status.textContent = "เปิด MY-BOT ไม่สำเร็จ ลอง Reload ส่วนขยายแล้วเปิดใหม่";
  });
});
const enabled = document.getElementById("enabled");
document.getElementById("clearCommentJournal").addEventListener("click", async () => {
  if (!confirm("ตรวจผลบน Facebook และประวัติงานแล้วใช่ไหม? งานเดิมจะไม่ส่งซ้ำ ระบบจะบันทึกการตรวจบนเซิร์ฟเวอร์ก่อนปลดล็อกบนเครื่อง")) return;
  const choice = prompt("ผลตรวจของคุณ?\n1 = ยืนยันว่าส่งแล้ว\n2 = ยืนยันว่าไม่ได้ส่ง\n3 = ยังไม่ชัดเจน\n4 = ตรวจแล้ว (ค่าเริ่มต้น)", "4");
  if (choice === null) return;
  const ownerOutcome = choice.trim() === "1" ? "confirmed_sent"
    : choice.trim() === "2" ? "confirmed_not_sent"
      : choice.trim() === "3" ? "still_uncertain"
        : "reviewed";
  const note = prompt("บันทึกสั้นๆ (ไม่บังคับ)", "") || "";
  status.textContent = "กำลังบันทึกการตรวจบนเซิร์ฟเวอร์…";
  chrome.runtime.sendMessage({ type: "clear-comment-journal", ownerOutcome, note }, async result => {
    void chrome.runtime.lastError;
    if (!result?.ok) {
      status.textContent = result?.error || "บันทึกบนเซิร์ฟเวอร์ไม่สำเร็จ จึงยังไม่ปลดล็อกบนเครื่อง";
      return;
    }
    await chrome.storage.local.remove("commentJournal");
    status.textContent = "บันทึกแล้วและปลดล็อกบนเครื่อง ตรวจกฎที่พักไว้บนเว็บก่อน Start ใหม่";
  });
});
const dedicatedReaderDesktop = document.getElementById("dedicatedReaderDesktop");
chrome.storage.local.get({ dedicatedReaderDesktop: false }, cfg => { dedicatedReaderDesktop.checked = cfg.dedicatedReaderDesktop; });
dedicatedReaderDesktop.addEventListener("change", async () => {
  await chrome.storage.local.set({ dedicatedReaderDesktop: dedicatedReaderDesktop.checked });
  chrome.runtime.sendMessage({ type: "heartbeat-now" }, () => void chrome.runtime.lastError);
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
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  const lan = typeof MyBotServerRoute !== "undefined" && MyBotServerRoute.isPrivateLanHostname?.(url.hostname);
  if (url.protocol === "https:" || (url.protocol === "http:" && (loopback || lan))) return { base: url.origin };
  return { error: "ต้องเป็น https:// (หรือ http://localhost / IP ในเครือข่ายบ้าน สำหรับเครื่องนี้)" };
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

function showRouteState(cfg) {
  const route = document.getElementById("routeState");
  if (!route) return;
  const mode = cfg.apiBaseMode === "manual" ? "ล็อกไว้" : "อัตโนมัติ";
  const reason = cfg.apiBaseRoute?.reason === "local_healthy" ? "local พร้อม"
    : cfg.apiBaseRoute?.reason === "production_healthy" ? "production พร้อม"
      : cfg.apiBaseRoute?.reason === "comment_in_flight" ? "ค้างงานคอมเมนต์"
        : cfg.apiBaseRoute?.reason === "manual" ? "ตามที่บันทึก"
          : cfg.apiBaseRoute?.reason || "ยังไม่ตรวจ";
  const kind = /localhost|127\.0\.0\.1/.test(String(cfg.apiBase || "")) ? "local" : "production";
  route.textContent = `เซิร์ฟเวอร์ตอนนี้: ${kind} · ${cfg.apiBase || "-"} (${mode} · ${reason})`;
}

chrome.storage.local.get({ apiBase: DEFAULT_BASE, apiBaseMode: "auto", apiBaseRoute: null, token: "", paused: false, quiet: null }, (cfg) => {
  apiBase.value = cfg.apiBase;
  token.value = String(cfg.token || "").startsWith("mbd_") ? "" : cfg.token;
  enabled.checked = !cfg.paused;
  showPairState(cfg);
  showRouteState(cfg);
  if (cfg.quiet && cfg.quiet.reason && Date.now() - cfg.quiet.at < 5 * 60 * 1000) status.textContent = "พักชั่วคราว: " + cfg.quiet.reason;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || (!changes.token && !changes.apiBase && !changes.apiBaseMode && !changes.apiBaseRoute)) return;
  chrome.storage.local.get({ apiBase: DEFAULT_BASE, apiBaseMode: "auto", apiBaseRoute: null, token: "", paused: false }, cfg => {
    apiBase.value = cfg.apiBase;
    enabled.checked = !cfg.paused;
    showPairState(cfg);
    showRouteState(cfg);
  });
});
document.getElementById("routeAuto").addEventListener("click", () => {
  status.textContent = "กำลังเลือกเซิร์ฟเวอร์อัตโนมัติ…";
  chrome.runtime.sendMessage({ type: "server-route-now", mode: "auto" }, result => {
    void chrome.runtime.lastError;
    if (!result?.ok) return void (status.textContent = "เลือกเซิร์ฟเวอร์อัตโนมัติไม่สำเร็จ");
    apiBase.value = result.apiBase;
    status.textContent = result.reason === "local_healthy" ? "ใช้แอปบนเครื่องแล้ว" : result.reason === "production_healthy" ? "ใช้ production แล้ว" : "อัปเดตเซิร์ฟเวอร์แล้ว";
    chrome.storage.local.get({ apiBase: DEFAULT_BASE, apiBaseMode: "auto", apiBaseRoute: null, token: "", paused: false }, cfg => {
      showPairState(cfg); showRouteState(cfg);
    });
  });
});

async function ensurePermission(base) {
  if (!needsOptionalPermission(base)) return true;
  const allowed = await chrome.permissions.request({ origins: [base + "/*"] });
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
  if (legacy && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(parsed.base)) {
    nextToken = stored.apiBase === parsed.base ? stored.token : "";
    status.textContent = "โทเคนแบบเดิมใช้ได้เฉพาะ localhost — กรุณาจับคู่ด้วยรหัสแทน";
  }
  const cfg = { apiBase: parsed.base, apiBaseMode: "manual", token: nextToken, paused: !enabled.checked };
  await chrome.storage.local.set(cfg);
  showPairState(cfg);
  showRouteState({ ...cfg, apiBaseRoute: { reason: "manual" } });
  if (!status.textContent.startsWith("โทเคนแบบเดิม")) status.textContent = "บันทึกแล้ว (ล็อกเซิร์ฟเวอร์นี้)";
  chrome.runtime.sendMessage({ type: "heartbeat-now" }, () => void chrome.runtime.lastError);
});

async function showOutbox() {
  const { outbox = [], outboxRejectedItems = 0, fullTextMetrics: detail, fullTextOverflow = 0 } = await chrome.storage.local.get({ outbox: [], outboxRejectedItems: 0, fullTextMetrics: null, fullTextOverflow: 0 });
  document.getElementById("outboxStatus").textContent = `คิวข้อมูล ${outbox.length} ชุด · ต้องตรวจ ${outbox.filter(item => item.problem).length} ชุด · ไม่รับเพิ่มเพราะเต็ม ${outboxRejectedItems} รายการ` + (detail ? ` · อ่านรายละเอียด: ลอง ${detail.tried} สำเร็จ ${detail.succeeded} ไม่สำเร็จ ${detail.failed} เหลือ ${detail.remaining} ต้องตรวจ ${detail.review || 0} เกินคิว ${fullTextOverflow} เก่าสุด ${Math.round((detail.oldestAgeMs || 0) / 60000)} นาที (${Math.round(detail.durationMs / 1000)} วินาที)` : "");
}
document.getElementById("clearOutboxProblems").addEventListener("click", async () => {
  if (!confirm("ยืนยันว่าตรวจรายการหมดอายุ/ถูกปฏิเสธแล้ว และยอมรับการลบข้อมูลเฉพาะรายการเหล่านี้?")) return;
  const { outbox = [] } = await chrome.storage.local.get({ outbox: [] });
  await chrome.storage.local.set({ outbox: outbox.filter(item => !item.problem), outboxBlocked: false });
  await showOutbox();
});
void showOutbox();

function showTabStatus(tabs) {
  document.getElementById("tabStatus").textContent = tabs
    ? `กำลังอ่าน ${tabs.activeReaders} · คอมเมนต์ ${tabs.activeComments} · รออ่านต่อ ${tabs.parkedReaders} · รอปิด ${tabs.closing} · รอเก็บกวาด ${tabs.idleReaders} · คืนให้เจ้าของแล้ว ${tabs.released}`
      + (tabs.closing ? " — Chrome ยังไม่ยืนยันการปิด ระบบจะลองใหม่" : tabs.parkedReaders ? " — เก็บตำแหน่งอ่านต่อ ปิดอัตโนมัติเมื่อพักเกิน 5 นาที หรือกดเก็บกวาดได้" : "")
    : "ยังอ่านสถานะแท็บบอทไม่ได้ ลองเปิดป๊อปอัปใหม่";
}
function refreshTabStatus(type = "bot-tabs-status") {
  chrome.runtime.sendMessage({ type }, result => {
    void chrome.runtime.lastError;
    showTabStatus(result?.ok ? result.tabs : null);
    document.getElementById("cleanupBotTabs").disabled = false;
  });
}
document.getElementById("cleanupBotTabs").addEventListener("click", () => {
  document.getElementById("cleanupBotTabs").disabled = true;
  refreshTabStatus("bot-tabs-cleanup");
});
refreshTabStatus();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && ["readers", "commentTab", "tabCleanup", "scrapeWindow", "scrapeContainers"].some(key => changes[key])) refreshTabStatus();
});
