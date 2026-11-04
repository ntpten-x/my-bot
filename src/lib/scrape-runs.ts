import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { findSourceByUrl } from "./sources";
import {
  EXTENSION_SOURCE_TYPES,
  PRIORITY_INTERVAL,
  isDue,
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
  error: "ผิดพลาด",
};

export async function buildExtensionConfig(now = new Date()) {
  const settings = await getSettings();
  const sources = await prisma.source.findMany({
    where: { type: { in: [...EXTENSION_SOURCE_TYPES] }, enabled: true },
    orderBy: { name: "asc" },
  });
  const due = sortDue(sources.filter((source) => isDue(source, now.getTime())));
  const ordered = [...due, ...sources.filter((source) => !due.includes(source))];
  // Known post keys for the sources the extension is likely to open this cycle, so it can stop scrolling early.
  const hints = new Map<string, { keys: string[]; lastSeenAt: string | null }>();
  const since = new Date(now.getTime() - Math.max(24, settings.maxPostAgeHours) * 3600_000);
  for (const source of due.slice(0, settings.maxGroupsPerCycle + 2)) {
    const rows = await prisma.post.findMany({
      where: { sourceId: source.id, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { externalUrl: true, postedAt: true, createdAt: true },
    });
    const keys = [...new Set(rows.map((row) => postKeyFromUrl(row.externalUrl)).filter(Boolean))];
    const newest = rows.reduce<Date | null>((max, row) => {
      const at = row.postedAt ?? null;
      return at && (!max || at > max) ? at : max;
    }, null);
    hints.set(source.id, { keys, lastSeenAt: newest?.toISOString() ?? null });
  }
  return {
    groups: ordered.map((source) => {
      const priority = normalizePriority(source.priority);
      const hint = hints.get(source.id);
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
      };
    }),
    maxGroupsPerCycle: settings.maxGroupsPerCycle,
    defaultIntervalMinutes: settings.fetchIntervalMinutes,
    jitterMinutes: settings.jitterMinutes,
    scrollScreens: settings.scrollScreens,
    maxAgeHours: settings.maxPostAgeHours,
    maxPostsPerRun: settings.maxPostsPerRun,
    serverScheduling: true,
    mode: "read-only" as const,
  };
}

export type ScrapeRunInput = {
  sourceUrl: string;
  ok: boolean;
  postsFound: number;
  newPosts: number;
  scrolls: number;
  stoppedBy: string;
  message?: string;
};

export async function recordScrapeRun(input: ScrapeRunInput, now = new Date(), random = Math.random) {
  const source = await findSourceByUrl(input.sourceUrl);
  if (!source) return null;
  const settings = await getSettings();
  const base = source.intervalMinutes || PRIORITY_INTERVAL[normalizePriority(source.priority)];
  const interval = nextAdaptiveInterval({
    current: source.currentIntervalMinutes || base,
    base,
    newPosts: input.newPosts,
    ok: input.ok,
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
      ...(input.ok ? { lastError: null } : { lastError: (input.message || "ดึงไม่สำเร็จ").slice(0, 500) }),
    },
  });
  const reason = STOP_REASON_LABEL[stop] ?? stop;
  await prisma.fetchLog.create({
    data: {
      sourceId: source.id,
      status: input.ok ? "ok" : "error",
      message: input.ok
        ? `รอบอ่าน: เห็น ${input.postsFound} ใหม่ ${input.newPosts} · เลื่อน ${input.scrolls} หน้าจอ · หยุดเพราะ${reason} · รอบหน้าอีก ~${interval} นาที`
        : (input.message || "ดึงไม่สำเร็จ").slice(0, 500),
      postsFound: input.ok ? input.newPosts : 0,
    },
  });
  return { sourceId: source.id, intervalMinutes: interval, nextRunAt };
}
