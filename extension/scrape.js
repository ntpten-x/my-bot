// Pure helpers for the read-only scroll scrape. Shared by background.js (importScripts) and tests (require).
// postKey() must stay identical to postKeyFromUrl() in src/lib/scrape-plan.ts.
(function (root) {
  const DEFAULT_SCREENS = 3;
  const MAX_SCREENS = 10;
  const MAX_POSTS_PER_RUN = 200;
  const MAX_SCROLLS = 30;
  const NORMAL_SCROLLS = 15;
  const KNOWN_STREAK = 3;
  const SWEEP_STREAK = 8;
  const OLD_STREAK = 3;

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
  // maxPosts is only a sane upper bound now; runs stop on known posts, not on a small cap.
  function scrapeSettings(remote) {
    const source = remote || {};
    return {
      screens: clampInt(source.scrollScreens, DEFAULT_SCREENS, 0, MAX_SCREENS),
      maxAgeMs: clampInt(source.maxAgeHours, 24, 1, 168) * 3600 * 1000,
      maxPosts: clampInt(source.maxPostsPerRun, MAX_POSTS_PER_RUN, 1, MAX_POSTS_PER_RUN),
    };
  }

  const HOUR = 3600 * 1000;
  const CATCHUP_MAX_MS = 72 * HOUR;
  const SWEEP_EVERY_MS = 60 * 60 * 1000;

  /**
   * Decide how deep one run goes.
   * - normal:  stop after KNOWN_STREAK consecutive known posts (max NORMAL_SCROLLS screens)
   * - sweep:   once an hour per source, keep going past 8 known posts (max MAX_SCROLLS)
   * - catchup: the last run is long ago (Chrome was closed) → read back to the newest stored post, up to 72 h
   * - audit:   coverage check, never stops on known posts, reads up to 72 h back
   */
  function planRun(input) {
    const opts = input || {};
    const now = opts.now || Date.now();
    const settings = opts.settings || scrapeSettings({});
    const group = opts.group || {};
    const lastRun = Date.parse(group.lastFetchedAt || "") || 0;
    const lastSeen = Date.parse(group.lastSeenAt || "") || 0;
    const interval = Math.max(5, Number(group.intervalMinutes) || 15) * 60 * 1000;
    const base = { maxPosts: MAX_POSTS_PER_RUN, maxScrolls: NORMAL_SCROLLS, knownStreak: KNOWN_STREAK, maxAgeMs: Math.max(settings.maxAgeMs, 24 * HOUR) };
    if (opts.audit) return { ...base, mode: "audit", maxScrolls: MAX_SCROLLS, knownStreak: Infinity, maxAgeMs: CATCHUP_MAX_MS };
    const gap = lastRun ? now - lastRun : Infinity;
    if (gap > Math.max(2 * HOUR, 3 * interval)) {
      const back = (lastSeen || lastRun) ? now - Math.min(lastSeen || now, lastRun || now) + HOUR : CATCHUP_MAX_MS;
      return { ...base, mode: "catchup", maxScrolls: MAX_SCROLLS, knownStreak: KNOWN_STREAK, maxAgeMs: Math.min(CATCHUP_MAX_MS, Math.max(base.maxAgeMs, back)) };
    }
    const lastSweep = Number(opts.lastSweepAt) || 0;
    if (now - lastSweep >= SWEEP_EVERY_MS) return { ...base, mode: "sweep", maxScrolls: MAX_SCROLLS, knownStreak: SWEEP_STREAK, maxAgeMs: Math.max(base.maxAgeMs, 48 * HOUR) };
    return { ...base, mode: "normal" };
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
      knownRun: 0,
      oldRun: 0,
      knownSeen: 0,
      reachedKnown: false,
      hitLimit: false,
      stalls: 0,
      mode: opts.mode || "normal",
      knownStreak: opts.knownStreak || KNOWN_STREAK,
      maxScrolls: opts.maxScrolls || NORMAL_SCROLLS,
      maxAgeMs: opts.maxAgeMs || 24 * HOUR,
      maxPosts: Math.min(opts.maxPosts || MAX_POSTS_PER_RUN, MAX_POSTS_PER_RUN),
      now: opts.now || Date.now(),
      stoppedBy: "",
    };
  }

  /**
   * Feed the posts parsed after one screen, in page order. Returns the reason to stop or "".
   * - seen: knownStreak known posts in a row (a pinned/featured known post alone never stops the run)
   * - old:  OLD_STREAK dated posts in a row older than the run window (one out-of-order old post does not stop it)
   * - end:  three screens in a row showed nothing new
   * - cap:  the sane upper bound of fresh posts for one run
   * - limit: the scroll budget for this mode is used up (caller checks run.steps)
   */
  function addStep(run, posts) {
    run.steps += 1;
    let newly = 0;
    let stop = "";
    for (const post of posts || []) {
      const key = postKey(post && post.url);
      if (!key || run.seen.has(key)) continue;
      run.seen.add(key);
      newly += 1;
      run.found += 1;
      if (stop) continue;
      if (run.known.has(key)) {
        run.knownSeen += 1;
        run.knownRun += 1;
        if (run.knownRun >= run.knownStreak) {
          run.reachedKnown = true;
          stop = "seen";
        }
        continue;
      }
      const at = post.postedAt ? Date.parse(post.postedAt) : NaN;
      if (Number.isFinite(at) && run.now - at > run.maxAgeMs) {
        run.oldRun += 1;
        if (run.oldRun >= OLD_STREAK) stop = "old";
        continue;
      }
      run.knownRun = 0;
      run.oldRun = 0;
      run.fresh.push(post);
      if (run.fresh.length >= run.maxPosts) {
        run.hitLimit = true;
        stop = "cap";
      }
    }
    if (!stop) {
      if (!newly) {
        run.emptySteps += 1;
        if (run.emptySteps >= 3) stop = "end";
      } else run.emptySteps = 0;
    }
    if (!stop && run.steps > run.maxScrolls) {
      run.hitLimit = true;
      stop = "limit";
    }
    if (stop) run.stoppedBy = stop;
    return stop;
  }

  // Per-run coverage stats sent to MY-BOT.
  function runStats(run) {
    return {
      mode: run.mode,
      reachedKnownPost: run.reachedKnown || (run.knownSeen > 0 && run.stoppedBy !== "limit" && run.stoppedBy !== "cap"),
      hitLimit: run.hitLimit,
      scrolls: Math.max(0, run.steps - 1),
      newCount: run.fresh.length,
      knownSeen: run.knownSeen,
      stalls: run.stalls,
    };
  }
  function cleanupText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/\s*(?:…|\.{3})\s*(?:ดูเพิ่มเติม|See more)\s*$/iu, "…")
      .trim();
  }

  const api = { postKey, scrapeSettings, planRun, scrollWaitMs, scrapeUrl, createRun, addStep, runStats, cleanupText, MAX_SCROLLS, KNOWN_STREAK, DEFAULT_SCREENS, MAX_SCREENS, MAX_POSTS_PER_RUN };
  root.MyBotScrape = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
