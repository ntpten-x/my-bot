// Pure helpers for the read-only scroll scrape. Shared by background.js (importScripts) and tests (require).
// postKey() must stay identical to postKeyFromUrl() in src/lib/scrape-plan.ts.
(function (root) {
  const DEFAULT_SCREENS = 3;
  const MAX_SCREENS = 10;
  const MAX_POSTS_PER_RUN = 200;
  const MAX_SCROLLS = 30;
  const MIN_SCROLLS = 10;
  const KNOWN_STREAK = 3;
  const SWEEP_STREAK = 8;
  const OLD_STREAK = 3;
  /** Empty screens in a row before "end" when the feed already showed several posts. */
  const EMPTY_STREAK = 5;
  /**
   * Background Facebook tabs often paint 0–1 articles first. Do not treat that as end-of-feed
   * until we have seen at least this many distinct posts, or hit the colder empty budget.
   */
  const MIN_FOUND_BEFORE_END = 3;
  const COLD_EMPTY_STREAK = 10;

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
  // maxPosts caps fresh posts per run; runs still stop early on known/old posts.
  function scrapeSettings(remote) {
    const source = remote || {};
    return {
      screens: clampInt(source.scrollScreens, DEFAULT_SCREENS, 0, MAX_SCREENS),
      maxAgeMs: clampInt(source.maxAgeHours, 24, 1, 24) * 3600 * 1000,
      maxPosts: clampInt(source.maxPostsPerRun, MAX_POSTS_PER_RUN, 1, MAX_POSTS_PER_RUN),
    };
  }

  /** Map settings.scrollScreens (0–10) → scroll budget 10–30 (default 3 → 16, 5 → 20). */
  function scrollBudget(screens) {
    const s = clampInt(screens, DEFAULT_SCREENS, 0, MAX_SCREENS);
    return Math.min(MAX_SCROLLS, Math.max(MIN_SCROLLS, MIN_SCROLLS + s * 2));
  }

  /**
   * Time budget for one feed pass. Scales with scroll depth; pass 2 is longer for shallow/incomplete recovery.
   * pass 1 with 20 scrolls ≈ 75 s; pass 2 ≈ 94 s; hard cap 120 s.
   */
  function feedBudgetMs(plan, pass) {
    const scrolls = Math.max(MIN_SCROLLS, Number(plan && plan.maxScrolls) || MIN_SCROLLS);
    if (pass === 2) return Math.min(120_000, 50_000 + scrolls * 2200);
    return Math.min(90_000, 35_000 + scrolls * 2000);
  }

  const HOUR = 3600 * 1000;
  // Owner rule: never ingest posts older than 24 h, including catch-up / sweep / audit.
  const CATCHUP_MAX_MS = 24 * HOUR;
  const SWEEP_EVERY_MS = 60 * 60 * 1000;

  /**
   * Decide how deep one run goes.
   * - normal:  stop after KNOWN_STREAK consecutive known posts (max NORMAL_SCROLLS screens)
   * - sweep:   once an hour per source, keep going past 8 known posts (max MAX_SCROLLS)
   * - catchup: long gap, shallow last run, or first run → read back up to 24 h
   * - audit:   coverage check, never stops on known posts, reads up to 24 h back
   * Owner policy: every enabled group, every post within 24 h; then keep ingesting new ones.
   */
  function planRun(input) {
    const opts = input || {};
    const now = opts.now || Date.now();
    const settings = opts.settings || scrapeSettings({});
    const group = opts.group || {};
    const lastRun = Date.parse(group.lastFetchedAt || "") || 0;
    const lastSeen = Date.parse(group.lastSeenAt || "") || 0;
    const interval = Math.max(5, Number(group.intervalMinutes) || 15) * 60 * 1000;
    const normalScrolls = scrollBudget(settings.screens);
    const deepScrolls = Math.min(MAX_SCROLLS, Math.max(normalScrolls + 10, scrollBudget(MAX_SCREENS)));
    const maxPosts = clampInt(settings.maxPosts, MAX_POSTS_PER_RUN, 1, MAX_POSTS_PER_RUN);
    const base = { maxPosts, maxScrolls: normalScrolls, knownStreak: KNOWN_STREAK, maxAgeMs: Math.min(CATCHUP_MAX_MS, Math.max(settings.maxAgeMs, HOUR)) };
    if (opts.audit) return { ...base, mode: "audit", maxScrolls: deepScrolls, knownStreak: Infinity, maxAgeMs: CATCHUP_MAX_MS };
    // Server flagged the previous pass as thin — dig the full ≤24 h window again.
    if (group.needsCoverage) {
      return { ...base, mode: "catchup", maxScrolls: deepScrolls, knownStreak: KNOWN_STREAK, maxAgeMs: CATCHUP_MAX_MS };
    }
    const gap = lastRun ? now - lastRun : Infinity;
    if (gap > Math.max(2 * HOUR, 3 * interval)) {
      const back = (lastSeen || lastRun) ? now - Math.min(lastSeen || now, lastRun || now) + HOUR : CATCHUP_MAX_MS;
      return { ...base, mode: "catchup", maxScrolls: deepScrolls, knownStreak: KNOWN_STREAK, maxAgeMs: Math.min(CATCHUP_MAX_MS, Math.max(base.maxAgeMs, back)) };
    }
    const lastSweep = Number(opts.lastSweepAt) || 0;
    if (now - lastSweep >= SWEEP_EVERY_MS) return { ...base, mode: "sweep", maxScrolls: deepScrolls, knownStreak: SWEEP_STREAK, maxAgeMs: CATCHUP_MAX_MS };
    return { ...base, mode: "normal" };
  }

  /**
   * Wait between screens.
   * - growing: feed is producing posts → shorter settle (0.9–2.0 s)
   * - default: 1.5–3.2 s (slightly tighter than before to cut idle stalls)
   */
  function scrollWaitMs(random, opts) {
    const r = typeof random === "function" ? random() : Math.random();
    if (opts && opts.growing) return Math.round(900 + r * 1100);
    return Math.round(1500 + r * 1700);
  }

  /** First pass looked incomplete — caller should reload and dig again. */
  function isShallowRun(run) {
    if (!run) return true;
    const stop = String(run.stoppedBy || "");
    if (stop === "seen" || stop === "old" || stop === "cap") return false;
    return (run.found || 0) < MIN_FOUND_BEFORE_END;
  }

  function isDeepMode(mode) {
    return mode === "catchup" || mode === "sweep" || mode === "audit";
  }

  /**
   * Background tab looks dead — abort so scrapeGroup can wake+reload.
   * Deep modes tolerate more stalls/steps before giving up (coverage recovery).
   */
  function shouldAbortDeadFeed(run) {
    if (!run) return true;
    if ((run.found || 0) >= 2) return false;
    const deep = isDeepMode(run.mode);
    const stallLimit = deep ? 8 : 4;
    const stepLimit = deep ? 6 : 3;
    return (run.stalls || 0) >= stallLimit && (run.steps || 0) >= stepLimit;
  }

  /** Settle after wake+reload before reading again. Deep retry waits longer for hydrate. */
  function postWakeSettleMs(plan, pass) {
    if (pass === 2 && isDeepMode(plan && plan.mode)) return 5500;
    if (pass === 2) return 4000;
    return 2800;
  }

  /** Cycle concurrency: single tab while throttled or any due group needs coverage. */
  function cycleParallel(input) {
    const opts = input || {};
    if (opts.recentlyThrottled) return 1;
    if ((opts.batch || []).some((group) => group && group.needsCoverage)) return 1;
    const fallback = Number(opts.defaultParallel);
    return Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 2;
  }

  /** Deep / coverage recovery must unthrottle the reader tab — Facebook often paints 1 article otherwise. */
  function shouldKeepAwake(plan, group) {
    if (group && group.needsCoverage) return true;
    return isDeepMode(plan && plan.mode);
  }

  /**
   * Mid-feed pulse: while keepAwake and the feed is still thin, briefly foreground every 2 steps.
   * Once several posts appear, stop pulsing so the owner keeps their tab.
   */
  function shouldPulseWake(input) {
    const opts = input || {};
    if (!opts.keepAwake) return false;
    if ((opts.found || 0) >= MIN_FOUND_BEFORE_END) return false;
    const steps = opts.steps || 0;
    return steps > 0 && steps % 2 === 0;
  }

  /** Stable sort: needsCoverage groups first so serial cycles heal incomplete sources before healthy ones. */
  function prioritizeCoverageDue(groups) {
    return [...(groups || [])].sort((a, b) => Number(Boolean(b && b.needsCoverage)) - Number(Boolean(a && a.needsCoverage)));
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
      maxScrolls: opts.maxScrolls || scrollBudget(DEFAULT_SCREENS),
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
   * - end:  empty screens in a row (EMPTY_STREAK, or COLD_EMPTY_STREAK while found < MIN_FOUND_BEFORE_END)
   * - cap:  the sane upper bound of fresh posts for one run
   * - limit: the scroll budget for this mode is used up (caller checks run.steps)
   */
  function emptyBudget(run) {
    return run.found < MIN_FOUND_BEFORE_END ? COLD_EMPTY_STREAK : EMPTY_STREAK;
  }

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
        if (run.emptySteps >= emptyBudget(run)) stop = "end";
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

  const api = {
    postKey, scrapeSettings, planRun, scrollBudget, feedBudgetMs, scrollWaitMs, scrapeUrl, createRun, addStep, emptyBudget, isShallowRun,
    isDeepMode, shouldAbortDeadFeed, postWakeSettleMs, cycleParallel, shouldKeepAwake, shouldPulseWake, prioritizeCoverageDue,
    runStats, cleanupText,
    MAX_SCROLLS, MIN_SCROLLS, KNOWN_STREAK, DEFAULT_SCREENS, MAX_SCREENS, MAX_POSTS_PER_RUN,
    EMPTY_STREAK, COLD_EMPTY_STREAK, MIN_FOUND_BEFORE_END,
  };
  root.MyBotScrape = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
