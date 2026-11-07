import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getSettings, upsertSettings, type AppSettings } from "./settings";
import { pruneSentKeys } from "./lease";
import { bangkokClock, shouldSendSummary } from "./smart/summary";
import { workerLog } from "./log";

const DAY = 24 * 3600_000;

export type RetentionPolicy = { postDays: number; leadDays: number; tombstoneDays: number };

export function retentionPolicy(settings: Pick<AppSettings, "postRetentionDays" | "leadRetentionDays">): RetentionPolicy {
  const postDays = Math.max(1, settings.postRetentionDays);
  const leadDays = Math.max(postDays, settings.leadRetentionDays);
  // Dedupe records outlive the posts (2x retention, at least 60 days) so a late re-read never re-alerts.
  return { postDays, leadDays, tombstoneDays: Math.max(60, postDays * 2) };
}

/** A post the owner acted on: saved/starred, replied to, or moved into the lead pipeline. */
export const LEAD_WHERE: Prisma.PostWhereInput = { OR: [{ isSaved: true }, { repliedAt: { not: null } }, { pipelineStatus: { not: "none" } }] };

// Old by both the stored time and the post time, so a post fetched today is never removed at once.
function olderThan(cut: Date): Prisma.PostWhereInput {
  return { createdAt: { lt: cut }, OR: [{ sortAt: null }, { sortAt: { lt: cut } }] };
}

/** Pure: which posts are expired at `now`. Ordinary posts after postDays, lead posts after leadDays. */
export function expiredPostsWhere(policy: RetentionPolicy, now: Date): Prisma.PostWhereInput {
  const postCut = new Date(now.getTime() - policy.postDays * DAY);
  const leadCut = new Date(now.getTime() - policy.leadDays * DAY);
  return {
    OR: [
      { AND: [olderThan(postCut), { NOT: LEAD_WHERE }] },
      { AND: [olderThan(leadCut)] },
    ],
  };
}

export async function retentionPreview(now = new Date()) {
  const settings = await getSettings();
  const policy = retentionPolicy(settings);
  const historyCut = new Date(now.getTime() - policy.postDays * DAY);
  const [posts, leads, totalPosts, fetchLogs, scrapeRuns, notifications, tombstones] = await Promise.all([
    prisma.post.count({ where: expiredPostsWhere(policy, now) }),
    prisma.post.count({ where: { AND: [LEAD_WHERE, olderThan(historyCut)] } }),
    prisma.post.count(),
    prisma.fetchLog.count({ where: { createdAt: { lt: historyCut } } }),
    prisma.scrapeRun.count({ where: { createdAt: { lt: historyCut } } }),
    prisma.notification.count({ where: { createdAt: { lt: historyCut } } }),
    prisma.postTombstone.count({ where: { createdAt: { lt: new Date(now.getTime() - policy.tombstoneDays * DAY) } } }),
  ]);
  return { policy, posts, leadsKeptLonger: Math.max(0, leads - 0), totalPosts, fetchLogs, scrapeRuns, notifications, tombstones };
}

export type RetentionResult = {
  at: string; posts: number; fetchLogs: number; scrapeRuns: number; notifications: number; tombstones: number; sentKeys: number; more: boolean; policy: RetentionPolicy;
};

/** Delete expired posts in batches (dependents cascade or are removed first), then trim old history. */
export async function purgeExpired(now = new Date(), options: { batchSize?: number; maxBatches?: number } = {}): Promise<RetentionResult> {
  const settings = await getSettings();
  const policy = retentionPolicy(settings);
  const batchSize = options.batchSize ?? 500;
  const maxBatches = options.maxBatches ?? 40;
  const where = expiredPostsWhere(policy, now);
  let posts = 0;
  let more = false;
  for (let i = 0; i < maxBatches; i += 1) {
    const rows = await prisma.post.findMany({ where, select: { id: true, contentHash: true, sourceId: true, externalUrl: true }, orderBy: { createdAt: "asc" }, take: batchSize });
    if (!rows.length) break;
    const ids = rows.map((row) => row.id);
    await prisma.$transaction([
      prisma.postTombstone.createMany({ data: rows.map((row) => ({ contentHash: row.contentHash, sourceId: row.sourceId, externalUrl: row.externalUrl })), skipDuplicates: true }),
      prisma.ruleHit.deleteMany({ where: { postId: { in: ids } } }),
      prisma.notification.deleteMany({ where: { postId: { in: ids } } }),
      prisma.post.updateMany({ where: { duplicateOfId: { in: ids } }, data: { duplicateOfId: null } }),
      // AiJob, Feedback, Note and ReplyQueueItem rows cascade with the post.
      prisma.post.deleteMany({ where: { id: { in: ids } } }),
    ]);
    posts += rows.length;
    if (i === maxBatches - 1 && rows.length === batchSize) more = true;
  }
  const historyCut = new Date(now.getTime() - policy.postDays * DAY);
  const [fetchLogs, scrapeRuns, notifications, tombstones] = await Promise.all([
    prisma.fetchLog.deleteMany({ where: { createdAt: { lt: historyCut } } }),
    prisma.scrapeRun.deleteMany({ where: { createdAt: { lt: historyCut } } }),
    prisma.notification.deleteMany({ where: { createdAt: { lt: historyCut } } }),
    prisma.postTombstone.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - policy.tombstoneDays * DAY) } } }),
  ]);
  // Preserve durable live dedupe keys/jobs, trim only bulky terminal payloads and old logs.
  const auditCut = new Date(now.getTime() - Math.max(90, policy.postDays) * DAY);
  await prisma.autoCommentLog.deleteMany({ where: { createdAt: { lt: auditCut } } });
  await prisma.autoCommentJob.updateMany({ where: { createdAt: { lt: auditCut }, status: { in: ["browser_observed", "sent", "dry_run", "cancelled", "failed", "unsupported"] } }, data: { message: "", lastError: "" } });
  await prisma.ingestReceipt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 14 * DAY) } } });
  await prisma.aiCache.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * DAY) } } });
  const sentBefore = await prisma.sentKey.count();
  await pruneSentKeys(Math.max(30, policy.postDays));
  const sentKeys = sentBefore - (await prisma.sentKey.count());
  return { at: now.toISOString(), posts, fetchLogs: fetchLogs.count, scrapeRuns: scrapeRuns.count, notifications: notifications.count, tombstones: tombstones.count, sentKeys: Math.max(0, sentKeys), more, policy };
}

/** Leader worker: once a day at 03:30 Bangkok (catches up if the worker was down). */
export async function maybeRunRetention(now = new Date()) {
  const clock = bangkokClock(now);
  const last = await prisma.setting.findUnique({ where: { key: "retention_last_day" } });
  if (!shouldSendSummary(clock.time, "03:30", last?.value ?? null, clock.day)) return null;
  const retry = await prisma.setting.findUnique({ where: { key: "retention_retry_after" } });
  if (retry && Date.parse(retry.value) > now.getTime()) return null;
  try {
    const result = await purgeExpired(now);
    await upsertSettings({ retention_last_result: JSON.stringify(result), retention_retry_after: "", ...(result.more ? {} : { retention_last_day: clock.day }) });
    await workerLog({
      message: `ลบข้อมูลเก่าอัตโนมัติ: โพสต์ ${result.posts} (เกิน ${result.policy.postDays} วัน, ลีดเกิน ${result.policy.leadDays} วัน) บันทึกดึง ${result.fetchLogs} รอบอ่าน ${result.scrapeRuns} แจ้งเตือน ${result.notifications}${result.more ? " — ยังเหลือ จะลบต่อพรุ่งนี้" : ""}`,
    }).catch(() => undefined);
    return result;
  } catch (error) {
    await upsertSettings({ retention_retry_after: new Date(now.getTime() + 5 * 60_000).toISOString() }).catch(() => undefined);
    await workerLog({ level: "error", message: "ลบข้อมูลเก่าไม่สำเร็จ", error: String(error).slice(0, 300) }).catch(() => undefined);
    return null;
  }
}
