import { prisma } from "./prisma";
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
  REFETCH_BACKOFF_MS,
  REFETCH_MAX_ATTEMPTS,
  REFETCH_PER_SOURCE,
  buildKnownHints,
  mergeRefetchUrls,
  pickRefetchFromPool,
  rankRefetch,
} from "./scrape-hints";

export const STOP_REASON_LABEL: Record<string, string> = {
  seen: "เจอโพสต์ที่เก็บแล้ว",
  old: "เจอโพสต์เก่าเกินกำหนด",
  cap: "ครบจำนวนต่อรอบ",
  end: "ไม่มีโพสต์เพิ่ม",
  screens: "เลื่อนครบตามที่ตั้ง",
  limit: "เลื่อนครบขีดจำกัดรอบนี้",
  error: "ผิดพลาด",
};

export { REFETCH_PER_SOURCE, REFETCH_MAX_ATTEMPTS, rankRefetch };

export type ReaderRun = { windowState: string; stalls: number; reloaded: boolean; throttled: boolean; fullTried: number; fullOk: number; durationMs: number };

/** Pure: 24 h health of the background reader window (minimized legacy or offscreen). */
export function summarizeReaderRuns(runs: ReaderRun[]) {
  const background = runs.filter((run) => run.windowState === "minimized" || run.windowState === "offscreen");
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
  };
}

export async function readerHealth(now = new Date()) {
  const runs = await prisma.scrapeRun.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) }, extVersion: { not: "" } },
    select: { windowState: true, stalls: true, reloaded: true, throttled: true, fullTried: true, fullOk: true, durationMs: true },
  });
  return summarizeReaderRuns(runs);
}

/** One batched knownKeys + refetch load for the due sources about to open this cycle. */
async function loadHintsForDue(sourceIds: string[], since: Date, now: Date) {
  const hints = new Map<string, { keys: string[]; lastSeenAt: string | null; refetch: string[] }>();
  if (!sourceIds.length) return hints;

  const rows = await prisma.post.findMany({
    where: {
      sourceId: { in: sourceIds },
      OR: [{ postedAt: { gte: since } }, { postedAt: null, createdAt: { gte: since } }],
    },
    orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
    select: { sourceId: true, externalUrl: true, postedAt: true, createdAt: true, text: true },
  });
  const known = buildKnownHints(sourceIds, rows, now);

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

  const bumpIds: { id: string; attempts: number }[] = [];
  for (const id of sourceIds) {
    const urls = new Set(refetchBySource.get(id) ?? []);
    for (const row of pool) {
      if (row.sourceId === id && urls.has(row.externalUrl)) bumpIds.push({ id: row.id, attempts: row.refetchAttempts });
    }
  }
  const byAttempts = new Map<number, string[]>();
  for (const row of bumpIds) byAttempts.set(row.attempts, [...(byAttempts.get(row.attempts) ?? []), row.id]);
  for (const [attempts, ids] of byAttempts) {
    await prisma.post.updateMany({
      where: { id: { in: ids } },
      data: { refetchAttempts: attempts + 1, refetchAfter: new Date(now.getTime() + REFETCH_BACKOFF_MS * (attempts + 1)) },
    });
  }

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
  // Keep keys for the ingest window (≤24 h) so catch-up / sweeps stop on known posts.
  const ageHours = Math.min(24, Math.max(1, settings.maxPostAgeHours));
  const since = new Date(now.getTime() - ageHours * 3600_000);
  const hintIds = due.slice(0, settings.maxGroupsPerCycle + 2).map((source) => source.id);
  const hints = await loadHintsForDue(hintIds, since, now);
  return {
    groups: ordered.map((source) => {
      const priority = normalizePriority(source.priority);
      const hint = hints.get(source.id);
      const needsCoverage = isIncompleteScrape({
        ok: source.lastRunStop !== "error",
        postsFound: source.lastRunFound,
        stoppedBy: source.lastRunStop || "",
        hitLimit: source.lastRunStop === "limit",
        reachedKnown: source.lastRunStop === "seen" || source.lastRunStop === "old" || source.lastRunStop === "cap",
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
  const nextRunAt = nextRunAfter(now, interval, settings.jitterMinutes, random);
  const stop = input.ok ? input.stoppedBy : "error";
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
  const flags = [cov.hitLimit && !cov.reachedKnownPost ? "⚠ ถึงขีดจำกัดก่อนเจอโพสต์เก่า" : "", cov.stalls ? `โหลดค้าง ${cov.stalls} ครั้ง` : "", cov.usedWindow ? "ใช้หน้าต่างแยก (รุ่นเก่า)" : "", cov.windowState ? `หน้าต่าง ${cov.windowState}` : "", cov.reloaded ? `รีโหลดซ้ำ (ค้าง ${cov.stallsFirst ?? 0} → ${cov.stallsRetry ?? 0})` : "", cov.throttled ? "Chrome หน่วงหน้าต่างพื้นหลัง" : "", cov.fullTried ? `อ่านข้อความเต็ม ${cov.fullOk ?? 0}/${cov.fullTried}` : ""].filter(Boolean).join(" · ");
  const prefix = mode === "audit" ? `ตรวจความครบ: เจอโพสต์ที่ยังไม่มีในระบบ ${input.newPosts} โพสต์ · ` : `รอบอ่าน (${MODE_LABEL[mode]}): `;
  await prisma.fetchLog.create({
    data: {
      sourceId: source.id,
      status: input.ok ? "ok" : "error",
      message: input.ok
        ? `${prefix}เห็น ${input.postsFound} ใหม่ ${input.newPosts} · เลื่อน ${input.scrolls} หน้าจอ · หยุดเพราะ${reason} · รอบหน้าอีก ~${interval} นาที${flags ? ` · ${flags}` : ""}`
        : (input.message || "ดึงไม่สำเร็จ").slice(0, 500),
      postsFound: input.ok ? input.newPosts : 0,
    },
  });
  return { sourceId: source.id, intervalMinutes: interval, nextRunAt };
}
