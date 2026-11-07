import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { bangkokStart } from "@/lib/format";
import { postInclude, serializePost } from "@/lib/serialize";
import { heartbeatIsStale, sourceIsStale } from "@/lib/extension-health";
import { aiQueueStats } from "@/lib/ai/stats";
import { EXTENSION_SOURCE_TYPES } from "@/lib/scrape-plan";
import { memo } from "@/lib/memo";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  // Dashboard numbers may be up to 30 s old; this saves ~1.4 s of Supabase round trips per load.
  return json(await memo("stats", 30_000, loadStats));
}

async function loadStats() {
  const start = bangkokStart(0);
  // One wave: every query starts at once (the pool runs up to 5 at a time).
  const [postsToday, unread, buyers, pipeline, enabledSources, errorSources, grouped, recent, logs, categories, seen, facebookSources, aiQueue] =
    await Promise.all([
      prisma.post.count({ where: { createdAt: { gte: start } } }),
      prisma.post.count({ where: { isRead: false, isAd: false, forbiddenHit: false } }),
      prisma.post.count({ where: { intent: "buyer", isAd: false, forbiddenHit: false } }),
      prisma.post.count({ where: { pipelineStatus: { not: "none" } } }),
      prisma.source.count({ where: { enabled: true } }),
      prisma.source.count({ where: { lastError: { not: null } } }),
      prisma.post.groupBy({
        by: ["categoryId"],
        where: { isAd: false, forbiddenHit: false },
        _count: { _all: true },
      }),
      prisma.post.findMany({
        where: { isAd: false, forbiddenHit: false, duplicateOfId: null },
        orderBy: [{ sortAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 6,
        include: postInclude,
        relationLoadStrategy: "join",
      }),
      prisma.fetchLog.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { source: true }, relationLoadStrategy: "join" }),
      prisma.category.findMany({ select: { id: true, name: true } }),
      prisma.setting.findUnique({ where: { key: "extension_last_seen" } }),
      prisma.source.findMany({ where: { type: { in: [...EXTENSION_SOURCE_TYPES] } }, orderBy: { name: "asc" } }),
      aiQueueStats(),
    ]);
  const byCategory = grouped
    .map((row) => ({
      id: row.categoryId,
      name: categories.find((category) => category.id === row.categoryId)?.name ?? "ยังไม่จัดหมวด",
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count);
  const lastSeen = seen?.value ? new Date(seen.value) : null;
  const validSeen = lastSeen && !Number.isNaN(lastSeen.getTime()) ? lastSeen : null;
  const enabledFacebook = facebookSources.filter((source) => source.enabled);
  const aged = enabledFacebook.some((source) => Date.now() - source.createdAt.getTime() >= 30 * 60 * 1000);
  const extensionStale =
    aged && (heartbeatIsStale(validSeen) || enabledFacebook.some((source) => sourceIsStale(source)));
  return {
    postsToday,
    aiQueue,
    unread,
    buyers,
    pipeline,
    enabledSources,
    errorSources,
    byCategory,
    recent: recent.map(serializePost),
    logs: logs.map((log) => ({
      id: log.id,
      status: log.status,
      message: log.message,
      postsFound: log.postsFound,
      createdAt: log.createdAt.toISOString(),
      sourceName: log.source?.name ?? "ระบบ",
    })),
    extension: {
      lastSeen: validSeen?.toISOString() ?? null,
      stale: extensionStale,
      sources: facebookSources.map((source) => ({
        id: source.id,
        name: source.name,
        enabled: source.enabled,
        lastExtensionAt: source.lastExtensionAt?.toISOString() ?? null,
        stale: sourceIsStale(source),
      })),
    },
  };
}
