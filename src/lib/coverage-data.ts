import { prisma } from "./prisma";
import { assessCoverage, type Coverage } from "./coverage";
import { EXPECTED_EXTENSION_VERSION } from "./extension-heartbeat";

type SourceLike = { id: string; type: string; lastRunAt: Date | null; currentIntervalMinutes: number; intervalMinutes: number };

// Coverage for extension-read sources from the last 24 h of runs plus the latest audit.
// Scoped to the expected extension version so older readers cannot mask current health.
export async function coverageBySource(sources: SourceLike[], now = new Date()): Promise<Map<string, Coverage>> {
  const ids = sources.filter((source) => source.type === "facebook_group" || source.type === "facebook_marketplace").map((source) => source.id);
  const result = new Map<string, Coverage>();
  if (!ids.length) return result;
  const version = EXPECTED_EXTENSION_VERSION;
  const [runs, audits, heartbeat, posts] = await Promise.all([
    prisma.scrapeRun.findMany({
      where: { sourceId: { in: ids }, createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) }, extVersion: version },
      orderBy: { createdAt: "desc" },
    }),
    prisma.scrapeRun.findMany({
      where: { sourceId: { in: ids }, mode: "audit", extVersion: version },
      orderBy: { createdAt: "desc" },
      distinct: ["sourceId"],
    }),
    prisma.extensionHeartbeat.findFirst({ where: { version }, orderBy: { lastSeenAt: "desc" } }),
    prisma.post.groupBy({ by: ["sourceId"], where: { sourceId: { in: ids } }, _count: { _all: true } }),
  ]);
  // Missing current-version heartbeat is unknown, never treated as healthy auto-fetch.
  const fresh = heartbeat && now.getTime() - heartbeat.lastSeenAt.getTime() < 10 * 60_000;
  const autoFetchOn = fresh ? heartbeat.enabled : null;
  const counts = new Map(posts.map((row) => [row.sourceId, row._count._all]));
  for (const source of sources) {
    if (!ids.includes(source.id)) continue;
    const own = runs.filter((run) => run.sourceId === source.id && run.mode !== "audit");
    const audit = audits.find((run) => run.sourceId === source.id);
    result.set(
      source.id,
      assessCoverage({
        runs: audit ? [...own, audit] : own,
        lastRunAt: source.lastRunAt,
        intervalMinutes: source.currentIntervalMinutes || source.intervalMinutes,
        autoFetchOn,
        hasStoredPosts: (counts.get(source.id) ?? 0) > 0,
        now,
      }),
    );
  }
  return result;
}