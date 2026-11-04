// Pure helpers for the read-only scroll scrape. Shared by background.js (importScripts) and tests (require).
// postKey() must stay identical to postKeyFromUrl() in src/lib/scrape-plan.ts.
(function (root) {
  const DEFAULT_SCREENS = 3;
  const MAX_SCREENS = 10;
  const MAX_POSTS_PER_RUN = 40;

  function postKey(input) {
    const value = String(input || "").trim();
    if (!value) return "";
    let url;
    try {
      url = new URL(value, "https://www.facebook.com");
    } catch {
      return value.toLowerCase();
    }
    const path = url.pathname;
    const item = path.match(/\/marketplace\/item\/(\d+)/i);
    if (item) return "mp:" + item[1];
    const post = path.match(/\/(?:posts|permalink)\/(\d+)/i);
    if (post) return "p:" + post[1];
    const story = url.searchParams.get("story_fbid") || url.searchParams.get("multi_permalinks");
    if (story && /^\d+$/.test(story.split(",")[0])) return "p:" + story.split(",")[0];
    const host = url.hostname.toLowerCase().replace(/^(m|web|www)\./, "");
    return ("u:" + host + path.replace(/\/+$/, "")).toLowerCase();
  }

  function clampInt(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  // Settings from /api/v1/extension-config, with safe defaults for older servers.
  function scrapeSettings(remote) {
    const source = remote || {};
    return {
      screens: clampInt(source.scrollScreens, DEFAULT_SCREENS, 0, MAX_SCREENS),
      maxAgeMs: clampInt(source.maxAgeHours, 24, 1, 168) * 3600 * 1000,
      maxPosts: clampInt(source.maxPostsPerRun, MAX_POSTS_PER_RUN, 1, MAX_POSTS_PER_RUN),
    };
  }

  // Random wait between screens: 1.5–4 seconds.
  function scrollWaitMs(random) {
    const r = typeof random === "function" ? random() : Math.random();
    return Math.round(1500 + r * 2500);
  }

  // Marketplace results sorted newest first; group feeds in chronological order. Read-only URL changes only.
  function scrapeUrl(url, kind) {
    const parsed = new URL(url);
    if (kind === "marketplace") {
      if (!parsed.searchParams.get("sortBy")) parsed.searchParams.set("sortBy", "creation_time_descend");
    } else if (!parsed.searchParams.get("sorting_setting")) {
      parsed.searchParams.set("sorting_setting", "CHRONOLOGICAL");
    }
    return parsed.href;
  }

  function createRun(options) {
    const opts = options || {};
    return {
      known: new Set((opts.knownKeys || []).map(String)),
      seen: new Set(),
      fresh: [],
      found: 0,
      steps: 0,
      emptySteps: 0,
      maxAgeMs: opts.maxAgeMs || 24 * 3600 * 1000,
      maxPosts: opts.maxPosts || MAX_POSTS_PER_RUN,
      now: opts.now || Date.now(),
      stoppedBy: "",
    };
  }

  /**
   * Feed the posts parsed after one screen. Returns the reason to stop ("seen" | "old" | "cap" | "end") or "".
   * - seen: every new post on this screen was already in MY-BOT (one pinned post on the first screen is not enough)
   * - old:  every new dated post on this screen is older than the max age
   * - end:  two screens in a row showed nothing new
   * - cap:  enough fresh posts for one run
   */
  function addStep(run, posts) {
    const isFirst = run.steps === 0;
    run.steps += 1;
    let newly = 0;
    let known = 0;
    let old = 0;
    let fresh = 0;
    for (const post of posts || []) {
      const key = postKey(post && post.url);
      if (!key || run.seen.has(key)) continue;
      run.seen.add(key);
      newly += 1;
      run.found += 1;
      if (run.known.has(key)) {
        known += 1;
        continue;
      }
      const at = post.postedAt ? Date.parse(post.postedAt) : NaN;
      if (Number.isFinite(at) && run.now - at > run.maxAgeMs) {
        old += 1;
        continue;
      }
      fresh += 1;
      if (run.fresh.length < run.maxPosts) run.fresh.push(post);
    }
    let stop = "";
    if (run.fresh.length >= run.maxPosts) stop = "cap";
    else if (!newly) {
      run.emptySteps += 1;
      if (run.emptySteps >= 2) stop = "end";
    } else {
      run.emptySteps = 0;
      const enough = !isFirst || known + old >= 2;
      if (!fresh && known && enough) stop = "seen";
      else if (!fresh && old && enough) stop = "old";
    }
    if (stop) run.stoppedBy = stop;
    return stop;
  }

  function cleanupText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/\s*(?:…|\.{3})\s*(?:ดูเพิ่มเติม|See more)\s*$/iu, "…")
      .trim();
  }

  const api = { postKey, scrapeSettings, scrollWaitMs, scrapeUrl, createRun, addStep, cleanupText, DEFAULT_SCREENS, MAX_SCREENS, MAX_POSTS_PER_RUN };
  root.MyBotScrape = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
