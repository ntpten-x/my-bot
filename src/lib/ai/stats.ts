import { prisma } from "../prisma";
import { percentiles, requestMetrics } from "../metrics";

export async function aiQueueStats() {
  const [counts, oldest, recent, errors] = await Promise.all([
    prisma.aiJob.groupBy({ by: ["status"], _count: true }),
    prisma.aiJob.findFirst({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, select: { createdAt: true, nextAttemptAt: true } }),
    prisma.aiJob.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 200, select: { status: true, attempts: true, latencyMs: true, queueWaitMs: true } }),
    prisma.aiJob.findMany({ where: { status: { in: ["pending", "failed"] }, lastError: { not: "" } }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, status: true, attempts: true, lastError: true, nextAttemptAt: true } }),
  ]);
  const terminal = recent.filter(job => job.status === "done" || job.status === "failed");
  return {
    counts: Object.fromEntries(counts.map(row => [row.status, row._count])),
    oldestPendingMs: oldest ? Math.max(0, Date.now() - oldest.createdAt.getTime()) : null,
    nextAttemptAt: oldest?.nextAttemptAt.toISOString() ?? null,
    processingMs: percentiles(terminal.flatMap(job => job.latencyMs == null ? [] : [job.latencyMs])),
    queueWaitMs: percentiles(terminal.flatMap(job => job.queueWaitMs == null ? [] : [job.queueWaitMs])),
    recentSample: recent.length,
    retriedJobs: recent.filter(job => job.attempts > 0).length,
    terminalSuccessRate: terminal.length ? terminal.filter(job => job.status === "done").length / terminal.length : null,
    errors,
    requests: requestMetrics(),
  };
}
