import { prisma } from "@/lib/prisma";
import { commentTarget } from "./matching";

type Stamp = Date | string | null;
type EvidenceLog = { id: string; event: string; createdAt: Date };
type EvidenceJob = {
  id: string; postId: string | null; postKey: string; externalUrl: string; sourceId: string;
  pageId: string; deliveryMode: string; browserFbUserId: string; message: string;
  status: string; dryRun: boolean; attempts: number; createdAt: Date; dispatchedAt: Date | null;
  remoteCommentId: string | null;
  post: { createdAt: Date; processingState: string; aiJobs: { status: string; createdAt: Date; updatedAt: Date; latencyMs: number | null; queueWaitMs: number | null }[] } | null;
};
type EvidenceSource = { type: string; url: string; fbGroupId: string | null };
type EvidenceOptions = {
  source?: EvidenceSource | null;
  evaluation?: { state: string; evaluatedAt: Date } | null;
  logs: EvidenceLog[]; totalLogs: number; account: { id: string; name: string } | null;
  milestones?: EvidenceLog[]; now?: Date;
};
const safeEvents = new Set(["pending", "pending_ai", "matched", "browser_ready", "claimed", "sending", "dispatch", "browser_observed", "sent", "uncertain", "uncertain_noted", "prepare_retry", "cancelled", "failed", "blocked", "not_sent", "permission_denied", "unavailable", "dry_run", "reconciled"]);
const hosts = new Set(["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"]);

/** Link only to the stored job target, never to arbitrary log/error text or query parameters. */
export function safeEvidenceTarget(job: Pick<EvidenceJob, "externalUrl" | "postKey" | "pageId" | "deliveryMode">, source?: EvidenceSource | null): string | null {
  try {
    const url = new URL(job.externalUrl);
    if (url.protocol !== "https:" || !hosts.has(url.hostname) || url.port || url.username || url.password) return null;
    if (job.deliveryMode === "extension") {
      const match = url.pathname.match(/^\/groups\/([a-zA-Z0-9._-]+)\/(?:posts|permalink)\/(\d+)\/?$/);
      if (!match) return null;
      let group = match[1].toLowerCase();
      if (source?.type === "facebook_group") {
        const sourceUrl = new URL(source.url);
        const sourceGroup = sourceUrl.pathname.match(/^\/groups\/([a-zA-Z0-9._-]+)\/?$/)?.[1]?.toLowerCase();
        if (sourceUrl.protocol === "https:" && hosts.has(sourceUrl.hostname) && !sourceUrl.username && !sourceUrl.password && !sourceUrl.port
          && sourceGroup && (group === sourceGroup || group === source.fbGroupId?.toLowerCase())) group = sourceGroup;
      }
      if (job.postKey !== `group:${group}:${match[2]}`) return null;
      return `https://www.facebook.com/groups/${match[1].toLowerCase()}/posts/${match[2]}/`;
    }
    const target = commentTarget(job.externalUrl, "facebook_page", job.pageId);
    if (!target.supported || target.postKey !== job.postKey) return null;
    return `https://www.facebook.com/${job.pageId}/posts/${target.remotePostId.split("_").pop()}/`;
  } catch { return null; }
}

export function buildCommentEvidence(job: EvidenceJob, options: EvidenceOptions) {
  const now = (options.now ?? new Date()).getTime();
  const logs = [...options.logs, ...(options.milestones ?? [])];
  const first = (events: string[]) => logs.filter(log => events.includes(log.event)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt ?? null;
  const ai = job.post?.aiJobs[0];
  const entries: { key: string; label: string; at: Stamp }[] = [
    { key: "ingest", label: "รับโพสต์เข้าฐานข้อมูล", at: job.post?.createdAt ?? null },
    { key: "queued", label: "สร้างงานคอมเมนต์", at: job.createdAt },
    { key: "ready", label: "เตรียมข้อความพร้อม", at: first(["browser_ready"]) },
    { key: "dispatch", label: "จอง/อนุญาตการส่ง (ยังไม่ยืนยันว่าส่งแล้ว)", at: job.dispatchedAt },
    { key: "observed", label: job.deliveryMode === "extension" ? "ส่วนขยายรายงานว่าพบคอมเมนต์ในหน้าจอ" : "Meta คืน Comment ID", at: first([job.deliveryMode === "extension" ? "browser_observed" : "sent"]) },
  ];
  const millis = (stamp: Stamp) => { const value = stamp == null ? NaN : new Date(stamp).getTime(); return Number.isFinite(value) && value <= now ? value : null; };
  const ingest = millis(entries[0].at);
  const outOfOrderAt = (index: number) => {
    const time = millis(entries[index].at);
    const previous = index > 0 ? millis(entries[index - 1].at) : null;
    return time != null && ((ingest != null && time < ingest) || (previous != null && time < previous));
  };
  const stages = entries.map((entry, index) => {
    const raw = entry.at == null ? null : new Date(entry.at).getTime();
    const time = millis(entry.at);
    const previous = index > 0 ? millis(entries[index - 1].at) : null;
    const outOfOrder = outOfOrderAt(index);
    return {
      key: entry.key, label: entry.label, at: time == null ? null : new Date(time).toISOString(),
      timing: raw == null || !Number.isFinite(raw) ? "missing" : raw > now ? "future" : outOfOrder ? "out_of_order" : "recorded",
      elapsedFromIngestMs: !outOfOrder && time != null && ingest != null && time >= ingest ? time - ingest : null,
      waitFromPreviousMs: !outOfOrder && index > 0 && !outOfOrderAt(index - 1) && time != null && previous != null && time >= previous ? time - previous : null,
    };
  });
  const targetUrl = safeEvidenceTarget(job, options.source);
  // Older browser reports lack a receipt. Only link a numeric persisted receipt for an observed result.
  const remote = job.remoteCommentId?.match(/^(?:(\d+)_)?(\d+)$/);
  const targetPostId = targetUrl?.match(/\/posts\/(\d+)\//)?.[1];
  const receiptStatus = job.deliveryMode === "extension" ? job.status === "browser_observed" : job.status === "sent";
  const receiptMatches = remote && (job.deliveryMode === "extension" ? !remote[1] : !remote[1] || remote[1] === targetPostId);
  const commentUrl = receiptStatus && targetUrl && receiptMatches && remote
    ? `${targetUrl}?comment_id=${remote[2]}` : null;
  return {
    job: { id: job.id, postId: job.postId, status: job.status, deliveryMode: job.deliveryMode, dryRun: job.dryRun, attempts: job.attempts, message: job.message },
    account: job.browserFbUserId ? { id: job.browserFbUserId, name: options.account?.id === job.browserFbUserId ? options.account.name : "" } : job.pageId ? { id: job.pageId, name: "Page" } : null,
    targetUrl, commentUrl, stages,
    processing: { state: job.post?.processingState ?? null, completedAt: null },
    ai: ai ? { status: ai.status, queuedAt: millis(ai.createdAt) == null ? null : ai.createdAt.toISOString(), recordUpdatedAt: millis(ai.updatedAt) == null ? null : ai.updatedAt.toISOString(), latencyMs: ai.latencyMs, queueWaitMs: ai.queueWaitMs, historicalSnapshot: true } : null,
    evaluation: options.evaluation ? { state: options.evaluation.state, evaluatedAt: millis(options.evaluation.evaluatedAt) == null ? null : options.evaluation.evaluatedAt.toISOString() } : null,
    logs: options.logs.map(log => ({ id: log.id, event: safeEvents.has(log.event) ? log.event : "unknown", at: millis(log.createdAt) == null ? null : log.createdAt.toISOString() })),
    coverage: { totalLogs: options.totalLogs, returnedLogs: options.logs.length, truncated: options.totalLogs > options.logs.length, order: "latest_first", milestoneLookup: "first_recorded_per_stage", processingCompletionUnavailable: true, browserCommentUrlNotPersisted: job.deliveryMode === "extension" && !commentUrl },
  };
}
export type CommentEvidenceData = ReturnType<typeof buildCommentEvidence>;

/** Every query is scoped to one job/post/account. No credentials or raw log messages leave this projection. */
export async function readCommentEvidence(id: string) {
  const job = await prisma.autoCommentJob.findUnique({ where: { id }, select: {
    id: true, postId: true, postKey: true, externalUrl: true, sourceId: true, pageId: true,
    deliveryMode: true, browserFbUserId: true, message: true, status: true, dryRun: true,
    attempts: true, createdAt: true, dispatchedAt: true, remoteCommentId: true,
    generation: true, // Used only to select the matching evaluation; deliberately omitted from response.
    post: { select: { createdAt: true, processingState: true, aiJobs: { take: 1, select: { status: true, createdAt: true, updatedAt: true, latencyMs: true, queueWaitMs: true } } } },
  } });
  if (!job) return null;
  const logSelect = { id: true, event: true, createdAt: true } as const;
  const [logs, totalLogs, ready, observed, evaluation, account, source] = await Promise.all([
    prisma.autoCommentLog.findMany({ where: { jobId: id }, select: logSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 }),
    prisma.autoCommentLog.count({ where: { jobId: id } }),
    prisma.autoCommentLog.findFirst({ where: { jobId: id, event: "browser_ready" }, select: logSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.autoCommentLog.findFirst({ where: { jobId: id, event: job.deliveryMode === "extension" ? "browser_observed" : "sent" }, select: logSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    job.postId ? prisma.autoCommentEvaluation.findUnique({ where: { generation_postId: { generation: job.generation, postId: job.postId } }, select: { state: true, evaluatedAt: true } }) : null,
    job.browserFbUserId ? prisma.fbAccount.findUnique({ where: { id: job.browserFbUserId }, select: { id: true, name: true } }) : null,
    job.sourceId ? prisma.source.findUnique({ where: { id: job.sourceId }, select: { type: true, url: true, fbGroupId: true } }) : null,
  ]);
  return buildCommentEvidence(job, { logs, totalLogs, evaluation, account, source, milestones: [ready, observed].filter((log): log is EvidenceLog => log != null) });
}
