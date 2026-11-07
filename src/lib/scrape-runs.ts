import { prisma } from "./prisma";
import { isTruncatedText } from "./pipeline/truncation";
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
  postKeyFromUrl,
  sortDue,
} from "./scrape-plan";

export const STOP_REASON_LABEL: Record<string, string> = {
  seen: "เจอโพสต์ที่เก็บแล้ว",
  old: "เจอโพสต์เก่าเกินกำหนด",
  cap: "ครบจำนวนต่อรอบ",
  end: "ไม่มีโพสต์เพิ่ม",
  screens: "เลื่อนครบตามที่ตั้ง",
  limit: "เลื่อนครบขีดจำกัดรอบนี้",
  error: "ผิดพลาด",
};

export const REFETCH_PER_SOURCE = 10;
export const REFETCH_MAX_ATTEMPTS = 8;
const REFETCH_BACKOFF_MS = 45 * 60_000;

type RefetchRow = { id: string; externalUrl: string; score: number; createdAt: Date; refetchAttempts: number };

/** Pure: newest and high-score first; posts tried fewer times win ties. */
export function rankRefetch(rows: RefetchRow[], now: Date, limit = REFETCH_PER_SOURCE) {
  const weight = (row: RefetchRow) => {
    const ageHours = Math.max(0, (now.getTime() - row.createdAt.getTime()) / 3600_000);
    return row.score + Math.max(0, 48 - ageHours) - row.refetchAttempts * 5;
  };
  return [...rows].sort((a, b) => weight(b) - weight(a)).slice(0, limit);
}

// Backlog of truncated posts (7 days). Handing one out pushes its next try back (45 min x attempts),
// so a post that keeps failing waits longer and stops after REFETCH_MAX_ATTEMPTS.
async function pickRefetch(sourceId: string, now: Date, legacy: string[]) {
  const rows = await prisma.post.findMany({
    where: {
      sourceId,
      truncated: true,
      refetchAttempts: { lt: REFETCH_MAX_ATTEMPTS },
      createdAt: { gte: new Date(now.getTime() - 7 * 24 * 3600_000) },
      OR: [{ refetchAfter: null }, { refetchAfter: { lte: now } }],
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, externalUrl: true, score: true, createdAt: true, refetchAttempts: true },
  });
  const picked = rankRefetch(rows, now);
  const byAttempts = new Map<number, string[]>();
  for (const row of picked) byAttempts.set(row.refetchAttempts, [...(byAttempts.get(row.refetchAttempts) ?? []), row.id]);
  for (const [attempts, ids] of byAttempts) {
    await prisma.post.updateMany({
      where: { id: { in: ids } },
      data: { refetchAttempts: attempts + 1, refetchAfter: new Date(now.getTime() + REFETCH_BACKOFF_MS * (attempts + 1)) },
    });
  }
  const urls = picked.map((row) => row.externalUrl);
  // Older rows saved before the truncated flag existed.
  for (const url of legacy) if (urls.length < REFETCH_PER_SOURCE && !urls.includes(url)) urls.push(url);
  return urls;
}

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

export async function buildExtensionConfig(now = new Date()) {
  const settings = await getSettings();
  const sources = await prisma.source.findMany({
    where: { type: { in: [...EXTENSION_SOURCE_TYPES] }, enabled: true },
    orderBy: { name: "asc" },
  });
  const due = sortDue(sources.filter((source) => isDue(source, now.getTime())));
  const ordered = [...due, ...sources.filter((source) => !due.includes(source))];
  // Known post keys for the sources the extension is likely to open this cycle, so it can stop scrolling early.
  const hints = new Map<string, { keys: string[]; lastSeenAt: string | null; refetch: string[] }>();
  // Keep keys for the ingest window (≤24 h) so catch-up / sweeps stop on known posts.
  const ageHours = Math.min(24, Math.max(1, settings.maxPostAgeHours));
  const since = new Date(now.getTime() - ageHours * 3600_000);
  for (const source of due.slice(0, settings.maxGroupsPerCycle + 2)) {
    const rows = await prisma.post.findMany({
      where: {
        sourceId: source.id,
        OR: [{ postedAt: { gte: since } }, { postedAt: null, createdAt: { gte: since } }],
      },
      orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
      take: 300,
      select: { externalUrl: true, postedAt: true, createdAt: true, text: true },
    });
    const keys = [...new Set(rows.map((row) => postKeyFromUrl(row.externalUrl)).filter(Boolean))];
    const newest = rows.reduce<Date | null>((max, row) => {
      const at = row.postedAt ?? null;
      return at && (!max || at > max) ? at : max;
    }, null);
    // Posts stored cut off at "See more": the extension opens their permalinks (read-only) for the full text.
    const refetch = await pickRefetch(source.id, now, rows.filter((row) => isTruncatedText(row.text)).map((row) => row.externalUrl));
    hints.set(source.id, { keys, lastSeenAt: newest?.toISOString() ?? null, refetch });
  }
  return {
    groups: ordered.map((source) => {
      const priority = normalizePriority(source.priority);
      const hint = hints.get(source.id);
      const needsCoverage = isIncompleteScrape({
        ok: source.lastRunStop !== "error",
        postsFound: source.lastRunFound,
        stoppedBy: source.lastRunStop || "",
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
  const incomplete = isIncompleteScrape({
    ok: input.ok,
    postsFound: input.postsFound,
    stoppedBy: input.stoppedBy,
  });
  const interval = nextAdaptiveInterval({
    current: source.currentIntervalMinutes || base,
    base,
    newPosts: input.newPosts,
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
  const cov = input.coverage ?? {};
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
