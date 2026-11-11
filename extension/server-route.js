// Chooses local vs production MY-BOT without sending secrets. Pure helpers for tests.
(function (root) {
  const LOCALS = ["http://127.0.0.1:8001", "http://localhost:8001"];

  function isPrivateLanHostname(hostname) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(hostname || ""));
    if (!match) return false;
    const parts = match.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return false;
    const [a, b] = parts;
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }

  function normalizeOrigin(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) return null;
      if (url.protocol === "https:") return url.origin;
      if (url.protocol === "http:" && (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || isPrivateLanHostname(url.hostname))) {
        return url.origin;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function healthOk(fetchFn, origin, timeoutMs = 2500) {
    const base = normalizeOrigin(origin);
    if (!base) return false;
    try {
      const response = await fetchFn(`${base}/api/v1/health`, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.json().catch(() => null);
      return Boolean(response.ok && body && body.ok === true);
    } catch {
      return false;
    }
  }

  async function productionFromInstall(fetchFn, getURL, fallback) {
    try {
      const response = await fetchFn(getURL("install-config.json"));
      const origin = normalizeOrigin((await response.json()).apiBase);
      if (origin) return origin;
    } catch { /* bundled install-config may be missing in unit tests */ }
    return normalizeOrigin(fallback) || "https://my-bot-e6bt.onrender.com";
  }

  async function localCandidatesFromInstall(fetchFn, getURL) {
    try {
      const response = await fetchFn(getURL("install-config.json"));
      const cfg = await response.json();
      const list = [];
      for (const item of [cfg.apiBase, ...(Array.isArray(cfg.localApiBases) ? cfg.localApiBases : [])]) {
        const origin = normalizeOrigin(item);
        // Only treat private/LAN http origins as local candidates here.
        if (origin && origin.startsWith("http://")) list.push(origin);
      }
      return [...new Set(list)];
    } catch {
      return [];
    }
  }

  /**
   * Auto prefers a healthy local app, then production. Manual locks the stored URL.
   * Never switches away from a comment journal's apiBase while a send is in flight.
   */
  async function pickServerOrigin({ fetchFn, getURL, stored, fallbackProduction }) {
    const mode = stored?.apiBaseMode === "manual" ? "manual" : "auto";
    if (mode === "manual") {
      const locked = normalizeOrigin(stored.apiBase);
      if (locked) return { origin: locked, mode, reason: "manual" };
    }
    const journalBase = normalizeOrigin(stored?.commentJournal?.apiBase);
    // Prefer a healthy journal host so an in-flight comment cannot pin forever to a suspended Render.
    if (journalBase && (await healthOk(fetchFn, journalBase))) {
      return { origin: journalBase, mode: "auto", reason: "comment_in_flight" };
    }

    for (const local of LOCALS) {
      if (await healthOk(fetchFn, local)) return { origin: local, mode: "auto", reason: "local_healthy" };
    }
    for (const local of await localCandidatesFromInstall(fetchFn, getURL)) {
      if (LOCALS.includes(local)) continue;
      if (await healthOk(fetchFn, local)) return { origin: local, mode: "auto", reason: "local_healthy" };
    }
    const production = await productionFromInstall(fetchFn, getURL, fallbackProduction);
    if (await healthOk(fetchFn, production)) return { origin: production, mode: "auto", reason: "production_healthy" };
    // Prefer loopback even when both probes failed — a suspended cloud host is worse than retrying local.
    const last = normalizeOrigin(stored?.apiBase);
    if (last && LOCALS.includes(last)) return { origin: last, mode: "auto", reason: "last_known_local" };
    if (last && last.startsWith("http://") && isPrivateLanHostname(new URL(last).hostname)) {
      return { origin: last, mode: "auto", reason: "last_known_local" };
    }
    if (LOCALS[0]) return { origin: LOCALS[0], mode: "auto", reason: "local_fallback" };
    if (last) return { origin: last, mode: "auto", reason: "last_known" };
    return { origin: production, mode: "auto", reason: "production_default" };
  }

  root.MyBotServerRoute = { LOCALS, normalizeOrigin, healthOk, productionFromInstall, pickServerOrigin, isPrivateLanHostname };
  if (typeof module !== "undefined") module.exports = root.MyBotServerRoute;
})(typeof globalThis !== "undefined" ? globalThis : this);
