// Runs in the extension worker. Device credentials never enter the web page or ZIP.
(function (root) {
  let tail = Promise.resolve();
  const locked = work => { const next = tail.then(work); tail = next.catch(() => undefined); return next; };
  function origin(value) {
    try {
      const url = new URL(value);
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
      return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) ? url.origin : null;
    } catch { return null; }
  }
  async function installOrigin() {
    const response = await fetch(chrome.runtime.getURL("install-config.json"));
    const value = origin((await response.json()).apiBase);
    if (!value) throw new Error("invalid install origin");
    return value;
  }
  async function open(deps) {
    const cfg = await deps.loadConfig();
    const apiBase = origin(deps.base(cfg));
    if (!apiBase) return { ok: false };
    await chrome.tabs.create({ url: apiBase + "/settings/extension", active: true });
    return { ok: true };
  }
  async function installed(details, deps) {
    if (details.reason !== "install") return;
    const stored = await chrome.storage.local.get({ token: "" });
    if (stored.token) return;
    await chrome.storage.local.set({ apiBase: await installOrigin() });
    await deps.syncCustomBridge().catch(() => undefined);
    await open(deps);
  }
  async function handle(message, sender, deps) {
    return locked(async () => {
      const cfg = await deps.loadConfig();
      const apiBase = origin(deps.base(cfg));
      let senderOrigin;
      try { senderOrigin = origin(new URL(sender.url).origin); } catch { senderOrigin = null; }
      if (!apiBase || !sender.tab || sender.frameId !== 0 || senderOrigin !== apiBase) return { ok: false, error: "ต้องเชื่อมต่อจากหน้า MY-BOT ที่ตั้งไว้" };
      const stored = await chrome.storage.session.get({ extensionConnectAttempt: null });
      const attempt = stored.extensionConnectAttempt;
      if (message.type === "extension-connect-begin") {
        if (cfg.token) return { ok: true, paired: true };
        if (attempt && attempt.until > Date.now() && attempt.tabId !== sender.tab.id) {
          const tab = await chrome.tabs.get(attempt.tabId).catch(() => null);
          if (tab) return { ok: false, error: "กำลังเชื่อมต่อจากแท็บ MY-BOT อีกแท็บ" };
        }
        let pending = (await chrome.storage.local.get({ pendingExtensionConnection: null })).pendingExtensionConnection;
        if (!pending || pending.apiBase !== apiBase) {
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          const token = "mbd_" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
          pending = { apiBase, token, tokenHash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""), tokenHint: "mbd_…" + token.slice(-4) };
          await chrome.storage.local.set({ pendingExtensionConnection: pending });
        }
        const nonce = crypto.randomUUID();
        await chrome.storage.session.set({ extensionConnectAttempt: { nonce, tabId: sender.tab.id, apiBase, until: Date.now() + 120000 } });
        return { ok: true, paired: false, nonce, tokenHash: pending.tokenHash, tokenHint: pending.tokenHint };
      }
      if (!attempt || attempt.nonce !== message.nonce || attempt.tabId !== sender.tab.id || attempt.apiBase !== apiBase || attempt.until <= Date.now()) return { ok: false, error: "การเชื่อมต่อหมดอายุ ลองใหม่อีกครั้ง" };
      if (message.type === "extension-connect-cancel") {
        await chrome.storage.session.set({ extensionConnectAttempt: null });
        return { ok: true };
      }
      if (message.type !== "extension-connect-complete" || cfg.token || typeof message.deviceId !== "string" || !message.deviceId || message.deviceId.length > 100) return { ok: false };
      const pending = (await chrome.storage.local.get({ pendingExtensionConnection: null })).pendingExtensionConnection;
      if (!pending || pending.apiBase !== apiBase || pending.tokenHash !== message.tokenHash) return { ok: false };
      await chrome.storage.local.set({ token: pending.token, deviceId: message.deviceId });
      await chrome.storage.local.remove("pendingExtensionConnection").catch(() => undefined);
      await chrome.storage.session.set({ extensionConnectAttempt: null });
      void deps.ready().catch(() => undefined);
      return { ok: true, paired: true };
    });
  }
  root.MyBotConnect = { installed, handle, open };
})(typeof globalThis !== "undefined" ? globalThis : this);
