// Chooses local vs production MY-BOT without sending secrets. Pure helpers for tests.
(function (root) {
  const LOCALS = ["http://127.0.0.1:8001", "http://localhost:8001"];

  function normalizeOrigin(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) return null;
      if (url.protocol === "https:") return url.origin;
      if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.origin;
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
    const production = await productionFromInstall(fetchFn, getURL, fallbackProduction);
    if (await healthOk(fetchFn, production)) return { origin: production, mode: "auto", reason: "production_healthy" };
    // Prefer loopback even when both probes failed — a suspended cloud host is worse than retrying local.
    const last = normalizeOrigin(stored?.apiBase);
    if (last && LOCALS.includes(last)) return { origin: last, mode: "auto", reason: "last_known_local" };
    if (LOCALS[0]) return { origin: LOCALS[0], mode: "auto", reason: "local_fallback" };
    if (last) return { origin: last, mode: "auto", reason: "last_known" };
    return { origin: production, mode: "auto", reason: "production_default" };
  }

  root.MyBotServerRoute = { LOCALS, normalizeOrigin, healthOk, productionFromInstall, pickServerOrigin };
  if (typeof module !== "undefined") module.exports = root.MyBotServerRoute;
})(typeof globalThis !== "undefined" ? globalThis : this);
