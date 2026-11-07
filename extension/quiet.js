// Quiet mode for the background reader: pause during the owner's chosen hours (e.g. gaming time).
// Spec: "HH:MM-HH:MM" ranges separated by commas; a range may cross midnight ("22:00-02:00").
// pauseOnFacebook must NOT block when the owner leaves a group/Marketplace tab open — that is
// required for in-window scraping; only pause on personal feed / messages / watch-like surfaces.
(function (root) {
  function minutes(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 24 || m > 59) return null;
    return Math.min(24 * 60, h * 60 + m);
  }
  function parseWindows(spec) {
    return String(spec || "")
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [a, b] = part.split("-");
        const start = minutes(a);
        const end = minutes(b);
        return start === null || end === null || start === end ? null : { start, end };
      })
      .filter(Boolean);
  }
  function inQuietWindow(spec, date) {
    const now = date || new Date();
    const at = now.getHours() * 60 + now.getMinutes();
    return parseWindows(spec).some(({ start, end }) => (start < end ? at >= start && at < end : at >= start || at < end));
  }

  /** Group feeds and Marketplace browse pages are scrape hosts — leaving them open must not pause reading. */
  function isScrapeHostFacebookUrl(url) {
    try {
      const path = new URL(String(url || ""), "https://www.facebook.com").pathname.toLowerCase();
      if (/^\/groups(\/|$)/.test(path)) return true;
      if (/^\/marketplace(\/|$)/.test(path) && !/^\/marketplace\/item\//.test(path)) return true;
      return false;
    } catch {
      return false;
    }
  }

  /**
   * True when pauseOnFacebook should stop the cycle.
   * - Scraping tabs never count as "owner using Facebook"
   * - Group / Marketplace browse tabs stay allowed (extension host window)
   * - Grace after a foreground scrape avoids immediate re-pause on the restored tab
   */
  function shouldPauseForFacebook(input) {
    const opts = input || {};
    if (!opts.pauseOnFacebook) return false;
    const now = Number(opts.now) || Date.now();
    if (Number(opts.graceUntil) > now) return false;
    if (!opts.activeTabUrl) return false;
    if (opts.activeTabId !== undefined && opts.activeTabId !== null && opts.scrapingTabIds && opts.scrapingTabIds.has(opts.activeTabId)) {
      return false;
    }
    try {
      const host = new URL(String(opts.activeTabUrl), "https://www.facebook.com").hostname.toLowerCase();
      if (!/(^|\.)facebook\.com$/.test(host)) return false;
    } catch {
      return false;
    }
    if (isScrapeHostFacebookUrl(opts.activeTabUrl)) return false;
    return true;
  }

  const api = { parseWindows, inQuietWindow, isScrapeHostFacebookUrl, shouldPauseForFacebook };
  root.MyBotQuiet = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
