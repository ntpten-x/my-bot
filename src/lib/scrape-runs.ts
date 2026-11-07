import { prisma } from "./prisma";
import { EXPECTED_EXTENSION_VERSION } from "./extension-heartbeat";
import { getSettings } from "./settings";
import { findSourceByUrl } from "./sources";
import {
  EXTENSION_SOURCE_TYPES,
  PRIORITY_INTERVAL,
  isDue,
  isIncompleteScrape,
  nextAdaptiveInterval,
  nextRunAfter,
  normalizePriority,
  sortDue,
} from "./scrape-plan";
import {
  REFETCH_MAX_ATTEMPTS,
  REFETCH_PER_SOURCE,
  buildKnownHints,
  mergeRefetchUrls,
  pickRefetchFromPool,
  rankRefetch,
  type HintPostRow,
} from "./scrape-hints";

export const STOP_REASON_LABEL: Record<string, string> = {
  seen: "เจอโพสต์ที่เก็บแล้ว",
  old: "เจอโพสต์เก่าเกินกำหนด",
  cap: "ครบจำนวนต่อรอบ",
  end: "ไม่พบโพสต์เพิ่มในรอบอ่าน",
  exhausted: "ไม่พบโพสต์เพิ่มหลังตรวจซ้ำ",
  screens: "เลื่อนครบตามที่ตั้ง",
  limit: "เลื่อนครบขีดจำกัดรอบนี้",
  error: "ผิดพลาด",
  loading: "ฟีดยังโหลดอยู่ — รออ่านต่อ",
  stalled: "ฟีดไม่คืบหน้าหลังลองกู้คืน — รอลองใหม่",
  yield: "พักให้กลุ่มอื่นแล้วกลับมาอ่านต่อ",
  logged_out: "ต้องเข้าสู่ระบบ Facebook ใหม่",
  checkpoint: "Facebook ขอให้เจ้าของตรวจสอบบัญชี",
};

export { REFETCH_PER_SOURCE, REFETCH_MAX_ATTEMPTS, rankRefetch };

export type ReaderRun = {
  windowState: string;
  stalls: number;
  reloaded: boolean;
  throttled: boolean;
  fullTried: number;
  fullOk: number;
  durationMs: number;
  extVersion?: string;
  found?: number;
  fresh?: number;
  inserted?: number;
  stoppedBy?: string;
  hitLimit?: boolean;
  ok?: boolean;
};

/** Pure: 24 h health of the background reader window (minimized legacy or offscreen). */
export function summarizeReaderRuns(runs: ReaderRun[]) {
  const background = runs.filter((run) => run.windowState === "minimized" || run.windowState === "offscreen");
  const fresh = runs.reduce((sum, run) => sum + (run.fresh || 0), 0);
  const durationMs = runs.reduce((sum, run) => sum + run.durationMs, 0);
  return {
    total: runs.length,
    minimized: background.length,
    stalled: runs.filter((run) => run.stalls > 0).length,
    stalledMinimized: background.filter((run) => run.stalls > 0).length,
    reloaded: runs.filter((run) => run.reloaded).length,
    throttled: runs.filter((run) => run.throttled).length,
    fullTried: runs.reduce((sum, run) => sum + run.fullTried, 0),
    fullOk: runs.reduce((sum, run) => sum + run.fullOk, 0),
    avgSeconds: runs.length ? Math.round(runs.reduce((sum, run) => sum + run.durationMs, 0) / runs.length / 1000) : 0,
    fresh,
    inserted: runs.reduce((sum, run) => sum + (run.inserted || 0), 0),
    freshPerMinute: durationMs > 0 ? Math.round(fresh * 60_000 / durationMs * 10) / 10 : 0,
    incomplete: runs.filter(run => isIncompleteScrape({ ok: run.ok !== false, postsFound: run.found || 0, stoppedBy: run.stoppedBy || "", hitLimit: run.hitLimit })).length,
    completed: runs.filter(run => run.ok !== false && !run.hitLimit && ["seen", "old", "exhausted"].includes(run.stoppedBy || "")).length,
    continuations: runs.filter(run => run.ok !== false && ["cap", "limit", "screens", "yield"].includes(run.stoppedBy || "")).length,
    recovering: runs.filter(run => run.ok !== false && ["loading", "stalled"].includes(run.stoppedBy || "")).length,
    errors: runs.filter(run => run.ok === false).length,
  };
}

/** Reader health for the current extension version only — older installs must not mask a fresh deploy. */
export async function readerHealth(now = new Date(), extVersion?: string) {
  const version = (extVersion || EXPECTED_EXTENSION_VERSION).trim();
  const runs = await prisma.scrapeRun.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) },
      ...(version ? { extVersion: version } : { extVersion: { not: "" } }),
    },
    select: { windowState: true, stalls: true, reloaded: true, throttled: true, fullTried: true, fullOk: true, durationMs: true, extVersion: true, found: true, fresh: true, inserted: true, stoppedBy: true, hitLimit: true, ok: true },
  });
  return { ...summarizeReaderRuns(runs), extVersion: version };
}

/** Bounded known-key queries plus one refetch pool; selecting hints does not count as an attempt. */
async function loadHintsForDue(sourceIds: string[], since: Date, now: Date) {
  const hints = new Map<string, { keys: string[]; lastSeenAt: string | null; refetch: string[] }>();
  if (!sourceIds.length) return hints;

  const rows: HintPostRow[] = [];
  let cursor = 0;
  // Bound rows and concurrent queries; a busy source cannot consume other sources' hints.
  await Promise.all(Array.from({ length: Math.min(4, sourceIds.length) }, async () => {
    while (cursor < sourceIds.length) {
      const id = sourceIds[cursor++];
      rows.push(...await prisma.post.findMany({
        where: {
          sourceId: id,
          OR: [{ postedAt: { gte: since } }, { postedAt: null, createdAt: { gte: since } }],
        },
        orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
        take: 300,
        select: { sourceId: true, externalUrl: true, postedAt: true, createdAt: true, text: true },
      }));
    }
  }));
  const known = buildKnownHints(sourceIds, rows);

  const pool = await prisma.post.findMany({
    where: {
      sourceId: { in: sourceIds },
      truncated: true,
      refetchAttempts: { lt: REFETCH_MAX_ATTEMPTS },
      createdAt: { gte: new Date(now.getTime() - 7 * 24 * 3600_000) },
      OR: [{ refetchAfter: null }, { refetchAfter: { lte: now } }],
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(2000, sourceIds.length * 60),
    select: { id: true, sourceId: true, externalUrl: true, score: true, createdAt: true, refetchAttempts: true },
  });
  const refetchBySource = pickRefetchFromPool(sourceIds, pool, now);

  // Actual retries/backoff belong to the extension's durable full-text queue.
  // A config poll must not exhaust attempts for groups that never got a reader slot.

  for (const id of sourceIds) {
    const base = known.get(id) ?? { keys: [], lastSeenAt: null, legacyTruncated: [] };
    hints.set(id, {
      keys: base.keys,
      lastSeenAt: base.lastSeenAt,
      refetch: mergeRefetchUrls(refetchBySource.get(id) ?? [], base.legacyTruncated, REFETCH_PER_SOURCE),
    });
  }
  return hints;
}

export async function buildExtensionConfig(now = new Date()) {
  const settings = await getSettings();
  const sources = await prisma.source.findMany({
    where: { type: { in: [...EXTENSION_SOURCE_TYPES] }, enabled: true },
    orderBy: { name: "asc" },
  });
  const due = sortDue(sources.filter((source) => isDue(source, now.getTime())));
  const ordered = [...due, ...sources.filter((source) => !due.includes(source))];
  // Keep dedupe keys for the configured ingest window (≤24 h), including rotated due groups.
  const ageHours = Math.min(24, Math.max(1, settings.maxPostAgeHours));
  const since = new Date(now.getTime() - ageHours * 3600_000);
  const hintIds = due.map((source) => source.id);
  const hints = await loadHintsForDue(hintIds, since, now);
  return {
    groups: ordered.map((source) => {
      const priority = normalizePriority(source.priority);
      const hint = hints.get(source.id);
      const needsCoverage = isIncompleteScrape({
        ok: source.lastRunStop !== "error",
        postsFound: source.lastRunFound,
        stoppedBy: source.lastRunStop || "",
        hitLimit: ["limit", "cap", "loading", "stalled", "yield"].includes(source.lastRunStop || ""),
        reachedKnown: source.lastRunStop === "seen" || source.lastRunStop === "old",
      });
      return {
        id: source.id,
        name: source.name,
        url: source.url,
        type: source.type,
        kind: source.type === "facebook_marketplace" ? "marketplace" : "group",
        priority,
        intervalMinutes: source.intervalMinutes,
        currentIntervalMinutes: source.currentIntervalMinutes || source.intervalMinutes,
        due: isDue(source, now.getTime()),
        nextRunAt: source.nextRunAt?.toISOString() ?? null,
        lastFetchedAt: source.lastFetchedAt?.toISOString() ?? null,
        knownKeys: hint?.keys ?? [],
        lastSeenAt: hint?.lastSeenAt ?? null,
        refetchUrls: hint?.refetch ?? [],
        // Last run looked shallow — ask the extension for a deep ≤24 h pass next.
        needsCoverage,
      };
    }),
    maxGroupsPerCycle: settings.maxGroupsPerCycle,
    defaultIntervalMinutes: settings.fetchIntervalMinutes,
    jitterMinutes: settings.jitterMinutes,
    scrollScreens: settings.scrollScreens,
    maxAgeHours: ageHours,
    maxPostsPerRun: settings.maxPostsPerRun,
    serverScheduling: true,
    quiet: { pauseOnFacebook: settings.quietPauseOnFacebook, window: settings.quietWindow, pauseWhenLocked: settings.quietPauseWhenLocked },
    mode: "read-only" as const,
  };
}

export type ScrapeRunInput = {
  sourceUrl: string;
  groupId?: string;
  ok: boolean;
  postsFound: number;
  newPosts: number;
  scrolls: number;
  stoppedBy: string;
  message?: string;
  mode?: string;
  coverage?: {
    reachedKnownPost?: boolean;
    hitLimit?: boolean;
    newCount?: number;
    stalls?: number;
    usedWindow?: boolean;
    windowState?: string;
    reloaded?: boolean;
    stallsFirst?: number;
    stallsRetry?: number;
    throttled?: boolean;
    heldForeground?: boolean;
    fullTried?: number;
    fullOk?: number;
    durationMs?: number;
    extVersion?: string;
  };
};

const MODE_LABEL: Record<string, string> = { normal: "ปกติ", sweep: "กวาดลึกรายชั่วโมง", catchup: "ตามเก็บย้อนหลัง", audit: "ตรวจความครบ" };

export async function recordScrapeRun(input: ScrapeRunInput, now = new Date(), random = Math.random) {
  const source = await findSourceByUrl(input.sourceUrl);
  if (!source) return null;
  const settings = await getSettings();
  const base = source.intervalMinutes || PRIORITY_INTERVAL[normalizePriority(source.priority)];
  const cov = input.coverage ?? {};
  const incomplete = isIncompleteScrape({
    ok: input.ok,
    postsFound: input.postsFound,
    stoppedBy: input.stoppedBy,
    hitLimit: Boolean(cov.hitLimit),
    reachedKnown: Boolean(cov.reachedKnownPost),
  });
  const interval = nextAdaptiveInterval({
    current: source.currentIntervalMinutes || base,
    base,
    newPosts: input.newPosts,
    seenNew: cov.newCount,
    ok: input.ok,
    incomplete,
  });
  // Productive slices continue after 30 s; stalled feeds yield to others and retry after 60 s.
  const continuing = input.ok && incomplete && ["cap", "limit", "screens", "yield"].includes(input.stoppedBy);
  const recovering = input.ok && incomplete && ["loading", "stalled"].includes(input.stoppedBy);
  const nextRunAt = nextRunAfter(now, continuing ? 0.5 : recovering ? 1 : interval, continuing || recovering ? 0 : settings.jitterMinutes, random);
  const stop = input.ok || ["logged_out", "checkpoint"].includes(input.stoppedBy) ? input.stoppedBy : "error";
  await prisma.source.update({
    where: { id: source.id },
    data: {
      currentIntervalMinutes: interval,
      nextRunAt,
      lastRunAt: now,
      lastRunFound: Math.max(0, input.postsFound),
      lastRunNew: Math.max(0, input.newPosts),
      lastRunScrolls: Math.max(0, input.scrolls),
      lastRunStop: stop.slice(0, 40),
      lastFetchedAt: now,
      lastExtensionAt: now,
      ...(input.groupId && /^\d{5,20}$/.test(input.groupId) && source.type === "facebook_group" ? { fbGroupId: input.groupId } : {}),
      ...(input.ok ? { lastError: null } : { lastError: (input.message || "ดึงไม่สำเร็จ").slice(0, 500) }),
    },
  });
  const reason = STOP_REASON_LABEL[stop] ?? stop;
  const mode = input.mode && MODE_LABEL[input.mode] ? input.mode : "normal";
  await prisma.scrapeRun.create({
    data: {
      sourceId: source.id,
      mode,
      ok: input.ok,
      found: Math.max(0, input.postsFound),
      fresh: Math.max(0, Math.round(cov.newCount ?? 0)),
      inserted: Math.max(0, input.newPosts),
      scrolls: Math.max(0, input.scrolls),
      stoppedBy: stop.slice(0, 40),
      reachedKnown: Boolean(cov.reachedKnownPost),
      hitLimit: Boolean(cov.hitLimit),
      stalls: Math.max(0, Math.round(cov.stalls ?? 0)),
      usedWindow: Boolean(cov.usedWindow),
      windowState: String(cov.windowState ?? "").slice(0, 20),
      reloaded: Boolean(cov.reloaded),
      stallsFirst: Math.max(0, Math.round(cov.stallsFirst ?? 0)),
      stallsRetry: Math.max(0, Math.round(cov.stallsRetry ?? 0)),
      throttled: Boolean(cov.throttled),
      fullTried: Math.max(0, Math.round(cov.fullTried ?? 0)),
      fullOk: Math.max(0, Math.round(cov.fullOk ?? 0)),
      durationMs: Math.max(0, Math.min(2_000_000_000, Math.round(cov.durationMs ?? 0))),
      extVersion: String(cov.extVersion ?? "").slice(0, 20),
    },
  });
  const flags = [cov.hitLimit && !cov.reachedKnownPost ? "⚠ ถึงขีดจำกัดก่อนเจอโพสต์เก่า" : "", cov.stalls ? `โหลดค้าง ${cov.stalls} ครั้ง` : "", cov.usedWindow ? "ใช้หน้าต่างแยก (รุ่นเก่า)" : "", cov.windowState ? `หน้าต่าง ${cov.windowState}` : "", cov.heldForeground ? "ค้างแท็บอ่านด้านหน้า" : "", cov.reloaded ? `รีโหลดซ้ำ (ค้าง ${cov.stallsFirst ?? 0} → ${cov.stallsRetry ?? 0})` : "", cov.throttled ? "Chrome หน่วงหน้าต่างพื้นหลัง" : "", cov.fullTried ? `อ่านข้อความเต็ม ${cov.fullOk ?? 0}/${cov.fullTried}` : ""].filter(Boolean).join(" · ");
  const prefix = mode === "audit" ? `ตรวจความครบ: เจอโพสต์ที่ยังไม่มีในระบบ ${input.newPosts} โพสต์ · ` : `รอบอ่าน (${MODE_LABEL[mode]}): `;
  await prisma.fetchLog.create({
    data: {
      sourceId: source.id,
      status: input.ok ? "ok" : "error",
      message: input.ok
        ? `${prefix}เห็น ${input.postsFound} ใหม่ ${input.newPosts} · เลื่อน ${input.scrolls} หน้าจอ · หยุดเพราะ${reason} · ${continuing ? "อ่านต่อใน ~30 วินาที" : recovering ? "นัดกู้ฟีดอีก ~1 นาที" : `รอบหน้าอีก ~${interval} นาที`}${flags ? ` · ${flags}` : ""}`
        : (input.message || "ดึงไม่สำเร็จ").slice(0, 500),
      postsFound: input.ok ? input.newPosts : 0,
    },
  });
  return { sourceId: source.id, intervalMinutes: interval, nextRunAt };
}
