// Isolated content script on the configured MY-BOT origin. Sends hashes, never credentials.
(function () {
  if (window.top !== window || globalThis.mybotConnectPageLoaded) return;
  globalThis.mybotConnectPageLoaded = true;
  let busy = false, again = false, done = false;
  const send = message => new Promise(resolve => {
    try { chrome.runtime.sendMessage(message, result => { void chrome.runtime.lastError; resolve(result || { ok: false }); }); }
    catch { resolve({ ok: false }); }
  });
  function publish(state, error = "") {
    document.documentElement?.setAttribute("data-mybot-connection", state);
    window.postMessage({ source: "mybot-ext", type: "extension-connect-status", state, error }, location.origin);
  }
  async function connect() {
    if (done) { publish("connected"); return; }
    if (busy) { again = true; return; }
    busy = true;
    let begin;
    try {
      begin = await send({ type: "extension-connect-begin" });
      if (!begin.ok) { publish("error", begin.error || "ยังเชื่อมต่อส่วนขยายไม่ได้"); return; }
      if (begin.paired) { done = true; publish("connected"); return; }
      publish("connecting");
      const response = await fetch("/api/extension-devices/connect", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenHash: begin.tokenHash, tokenHint: begin.tokenHint, name: ("Chrome " + navigator.platform).slice(0, 60) }),
      });
      if (response.status === 401) { publish("auth-required", "ล็อกอิน MY-BOT แล้วระบบจะเชื่อมต่อให้อัตโนมัติ"); return; }
      const data = await response.json();
      if (!response.ok || !data.ok) { publish("error", data.error || "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
      const result = await send({ type: "extension-connect-complete", nonce: begin.nonce, tokenHash: begin.tokenHash, deviceId: data.deviceId });
      if (!result.ok) { publish("error", result.error || "ยังบันทึกการเชื่อมต่อไม่ได้"); return; }
      done = true; publish("connected");
    } catch { publish("error", "เชื่อมต่อไม่สำเร็จ ตรวจว่า MY-BOT เปิดอยู่แล้วลองใหม่"); }
    finally {
      if (begin?.nonce && !done) await send({ type: "extension-connect-cancel", nonce: begin.nonce });
      busy = false;
      if (again) { again = false; void connect(); }
    }
  }
  window.addEventListener("message", event => {
    if (event.source === window && event.origin === location.origin && event.data?.source === "mybot-app" && event.data?.type === "extension-connect") void connect();
  });
  window.addEventListener("focus", () => void connect());
  window.addEventListener("online", () => void connect());
  void connect();
})();
