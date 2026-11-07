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
  // maxPosts is the durable batch threshold; time/scroll budgets yield and retain the DOM cursor.
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
   * - sweep:   once an hour per source, ignore known posts and verify coverage
   * - catchup: long gap, incomplete last run, or first run → read back up to 24 h, ignoring known head posts
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
    if (opts.audit) return { ...base, mode: "audit", maxScrolls: deepScrolls, knownStreak: Infinity };
    // Server flagged the previous pass as thin — dig the full ≤24 h window again.
    if (group.needsCoverage) {
      return { ...base, mode: "catchup", maxScrolls: deepScrolls, knownStreak: Infinity };
    }
    const gap = lastRun ? now - lastRun : Infinity;
    if (gap > Math.max(2 * HOUR, 3 * interval)) {
      const back = (lastSeen || lastRun) ? now - Math.min(lastSeen || now, lastRun || now) + HOUR : CATCHUP_MAX_MS;
      return { ...base, mode: "catchup", maxScrolls: deepScrolls, knownStreak: Infinity, maxAgeMs: Math.min(base.maxAgeMs, Math.max(HOUR, back)) };
    }
    const lastSweep = Number(opts.lastSweepAt) || 0;
    if (now - lastSweep >= SWEEP_EVERY_MS) return { ...base, mode: "sweep", maxScrolls: deepScrolls, knownStreak: Infinity };
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
    return (run.stalls || 0) - (run.stallStart || 0) >= stallLimit && (run.steps || 0) - (run.sliceStart || 0) >= stepLimit;
  }

  /** Settle after wake+reload before reading again. Deep retry waits longer for hydrate. */
  function postWakeSettleMs(plan, pass) {
    if (pass === 2 && isDeepMode(plan && plan.mode)) return 5500;
    if (pass === 2) return 4000;
    return 2800;
  }

  /** Hard serial window after Chrome throttle; soft window still cautious; then normal. */
  const THROTTLE_HARD_MS = 5 * 60 * 1000;
  const THROTTLE_SOFT_MS = 15 * 60 * 1000;

  function throttleLevel(throttledAt, now) {
    const at = Number(throttledAt) || 0;
    if (!at) return "none";
    const age = (Number(now) || Date.now()) - at;
    if (age < 0 || age >= THROTTLE_SOFT_MS) return "none";
    if (age < THROTTLE_HARD_MS) return "hard";
    return "soft";
  }

  /**
   * How many due groups to take this cycle. Avoid the old "2 for 30 minutes" starvation —
   * hard throttle still small, soft/coverage allow a wider round-robin slice.
   */
  function cycleBatchLimit(input) {
    const opts = input || {};
    const limit = Math.max(1, Math.floor(Number(opts.limit) || 20));
    const level = opts.throttleLevel || throttleLevel(opts.throttledAt, opts.now);
    if (level === "hard") return Math.min(limit, 3);
    if (level === "soft") return Math.min(limit, opts.needsCoverageDue ? 4 : 6);
    if (opts.needsCoverageDue) return Math.min(limit, 6);
    return limit;
  }

  /** Cycle concurrency: single tab while hard-throttled or any due group needs coverage. */
  function cycleParallel(input) {
    const opts = input || {};
    const level = opts.throttleLevel || (opts.recentlyThrottled ? "hard" : "none");
    if (level === "hard") return 1;
    if ((opts.batch || []).some((group) => group && group.needsCoverage)) return 1;
    if (level === "soft") return 1;
    const fallback = Number(opts.defaultParallel);
    return Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 2;
  }

  /** Rotate so the group after cursorId leads — stops one high-priority source from always going first. */
  function rotateDue(groups, cursorId) {
    const list = [...(groups || [])];
    if (!cursorId || !list.length) return list;
    const idx = list.findIndex((group) => group && group.id === cursorId);
    if (idx < 0) return list;
    return list.slice(idx + 1).concat(list.slice(0, idx + 1));
  }

  /** Deep / coverage recovery must unthrottle the reader tab — Facebook often paints 1 article otherwise. */
  function shouldKeepAwake(plan, group) {
    if (group && group.needsCoverage) return true;
    return isDeepMode(plan && plan.mode);
  }

  /**
   * Hold the reader tab active for the whole feed pass (not just a pulse).
   * Same gate as shouldKeepAwake — catchup/sweep/audit or server needsCoverage.
   */
  function shouldHoldForeground(plan, group) {
    return shouldKeepAwake(plan, group);
  }

  /**
   * Mid-feed pulse: while keepAwake and the feed is still thin, briefly foreground every 2 steps.
   * Used only when we are not already holding the tab in the foreground for the whole pass.
   */
  function shouldPulseWake(input) {
    const opts = input || {};
    if (!opts.keepAwake || opts.holdForeground) return false;
    if ((opts.found || 0) >= MIN_FOUND_BEFORE_END) return false;
    const steps = opts.steps || 0;
    return steps > 0 && steps % 2 === 0;
  }

  /** Stable sort: needsCoverage groups first so serial cycles heal incomplete sources before healthy ones. */
  function prioritizeCoverageDue(groups) {
    return [...(groups || [])].sort((a, b) => Number(Boolean(b && b.needsCoverage)) - Number(Boolean(a && a.needsCoverage)));
  }

  /**
   * Coverage-needy first, then round-robin within each tier using the last finished group id.
   * Keeps catch-up fair when many groups are overdue at once.
   */
  function orderDueGroups(groups, options) {
    const opts = options || {};
    // A source overdue by its own interval wins over repeated coverage recovery.
    const now = opts.now || Date.now();
    const aged = (groups || []).filter(group => {
      const at = Date.parse(group.nextRunAt || "");
      return Number.isFinite(at) && now - at >= Math.max(2, Number(group.intervalMinutes) || 10) * 60_000;
    }).sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt));
    const agedIds = new Set(aged.map(group => group.id));
    const ranked = prioritizeCoverageDue((groups || []).filter(group => !agedIds.has(group.id)));
    const needy = ranked.filter((group) => group && group.needsCoverage);
    const healthy = ranked.filter((group) => !(group && group.needsCoverage));
    const coverage = rotateDue(needy, opts.cursorId), regular = rotateDue(healthy, opts.cursorId);
    const ordered = [...aged];
    while (coverage.length || regular.length) ordered.push(...coverage.splice(0, 2), ...regular.splice(0, 1));
    return ordered;
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
      newCount: 0,
      found: 0,
      steps: 0,
      sliceStart: 0,
      stallStart: 0,
      emptySteps: 0,
      knownRun: 0,
      oldRun: 0,
      orderedDates: 0,
      lastDatedAt: null,
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
      recoveredEnd: false,
    };
  }

  /**
   * Feed the posts parsed after one screen, in page order. Returns the reason to stop or "".
   * - seen: knownStreak known posts in a row (a pinned/featured known post alone never stops the run)
   * - old:  OLD_STREAK dated posts in a row older than the run window (one out-of-order old post does not stop it)
   * - end:  empty screens in a row (EMPTY_STREAK, or COLD_EMPTY_STREAK while found < MIN_FOUND_BEFORE_END)
   * - cap: batch ready; caller drains and keeps reading
   * - limit: slice budget used; caller saves the tab to continue later
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
      const at = post.postedAt ? Date.parse(post.postedAt) : NaN;
      run.orderedDates = Number.isFinite(at) ? (run.lastDatedAt === null || at <= run.lastDatedAt ? run.orderedDates + 1 : 1) : 0;
      run.lastDatedAt = Number.isFinite(at) ? at : null;
      if (Number.isFinite(at) && run.now - at > run.maxAgeMs) {
        run.knownRun = 0;
        run.oldRun += 1;
        continue;
      }
      if (run.known.has(key)) {
        run.oldRun = 0;
        run.knownSeen += 1;
        run.knownRun += 1;
        continue;
      }
      run.knownRun = 0;
      run.oldRun = 0;
      run.fresh.push(post);
      run.newCount += 1;
      // Read the entire DOM snapshot, including fresh posts after a known/old streak.
      // A batch boundary must never mark unread posts as seen.
      stop = "";
    }
    if (run.knownRun >= run.knownStreak) stop = "seen";
    const oldStreak = isDeepMode(run.mode) ? OLD_STREAK * 4 : OLD_STREAK;
    if (run.oldRun >= oldStreak && run.orderedDates >= oldStreak) stop = "old";
    if (stop === "seen") run.reachedKnown = true;
    if (!stop && run.fresh.length >= run.maxPosts) { run.hitLimit = true; stop = "cap"; }
    if (!stop) {
      if (!newly) {
        run.emptySteps += 1;
        if (run.emptySteps >= emptyBudget(run)) stop = "end";
      } else run.emptySteps = 0;
    }
    if (!stop && run.steps - run.sliceStart > run.maxScrolls) {
      run.hitLimit = true;
      stop = "limit";
    }
    if (stop) run.stoppedBy = stop;
    return stop;
  }

  function resumeRun(run, now = Date.now()) {
    run.sliceStart = run.steps;
    run.stallStart = run.stalls;
    run.now = now;
    run.stoppedBy = "";
    run.hitLimit = false;
    // Keep no-progress verification across slices so short budgets can finish a quiet feed.
    run.emptySteps = Math.max(0, run.emptySteps || 0);
    run.endSignals = 0;
    return run;
  }

  function snapshotRun(run) {
    return { ...run, known: [...run.known], seen: [...run.seen], knownStreak: Number.isFinite(run.knownStreak) ? run.knownStreak : null };
  }

  function restoreRun(saved) {
    return { ...saved, known: new Set(saved.known || []), seen: new Set(saved.seen || []), knownStreak: saved.knownStreak === null ? Infinity : saved.knownStreak };
  }

  function yieldRun(run, reason = "limit") {
    run.stoppedBy = reason;
    run.hitLimit = true;
    return run;
  }

  // Per-run coverage stats sent to MY-BOT.
  function runStats(run) {
    return {
      mode: run.mode,
      reachedKnownPost: run.reachedKnown && !run.hitLimit,
      hitLimit: run.hitLimit,
      scrolls: Math.max(0, run.steps - 1),
      newCount: run.newCount,
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

  function feedRoot(doc, kind) {
    const article = doc.querySelector(kind === "marketplace" ? 'a[href*="/marketplace/item/"]' : '[role="article"], [aria-posinset]');
    const main = article?.closest('[role="main"]') || doc.querySelector('[role="main"]');
    return main?.querySelector('[role="feed"]') || main || doc.querySelector('[role="feed"]');
  }

  function scrollRoot(doc, kind) {
    const article = doc.querySelector(kind === "marketplace" ? 'a[href*="/marketplace/item/"]' : '[role="article"], [aria-posinset]');
    for (let node = article?.parentElement; node && node !== doc.body; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 100 && /^(auto|scroll)$/.test(doc.defaultView.getComputedStyle(node).overflowY)) return node;
    }
    return doc.scrollingElement || doc.documentElement;
  }

  function feedStatus(doc, kind) {
    const feed = feedRoot(doc, kind);
    if (!feed) return { loading: false, endOfFeed: false };
    const visible = node => {
      if (node.closest('[hidden], [aria-hidden="true"], [role="article"], [aria-posinset], [role="dialog"], [role="navigation"], [role="complementary"]')) return false;
      const style = doc.defaultView.getComputedStyle(node), rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < doc.defaultView.innerHeight;
    };
    return {
      loading: (feed.getAttribute('aria-busy') === 'true' && visible(feed)) || [...feed.querySelectorAll('[role="progressbar"], [aria-busy="true"]')].some(visible),
      endOfFeed: [...feed.querySelectorAll('[role="status"]')].some(node => visible(node) && /no more (?:posts|results)|you're all caught up|ไม่มีโพสต์เพิ่มเติม|ไม่มีผลลัพธ์เพิ่มเติม/i.test(node.textContent || "")),
    };
  }

  const api = {
    postKey, scrapeSettings, planRun, scrollBudget, feedBudgetMs, scrollWaitMs, scrapeUrl, createRun, addStep, emptyBudget, isShallowRun,
    isDeepMode, shouldAbortDeadFeed, postWakeSettleMs, throttleLevel, cycleBatchLimit, cycleParallel, shouldKeepAwake, shouldHoldForeground, shouldPulseWake,
    prioritizeCoverageDue, rotateDue, orderDueGroups,
    runStats, cleanupText, resumeRun, snapshotRun, restoreRun, yieldRun, feedRoot, scrollRoot, feedStatus,
    MAX_SCROLLS, MIN_SCROLLS, KNOWN_STREAK, DEFAULT_SCREENS, MAX_SCREENS, MAX_POSTS_PER_RUN,
    EMPTY_STREAK, COLD_EMPTY_STREAK, MIN_FOUND_BEFORE_END, THROTTLE_HARD_MS, THROTTLE_SOFT_MS,
  };
  root.MyBotScrape = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
