import { globalDispatchDelay, groupDispatchDelay, combineDispatchDelays, type DispatchDelay } from "./dispatch-budget";
import { commentTypeAllowed } from "./type-setup";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type AutoCommentJob } from "@prisma/client";
import { prisma } from "../prisma";
import { recordTiming } from "../metrics";
import { explainCommentRule, isKeywordBotRule, matchesCommentRule, templateIndex, jsonList } from "./matching";
import { lockCommentControl, mayRun, readCommentControl, storeCommentControl, type CommentControl } from "./control";
import { migrateStaleBrowserDevicePins } from "./admin";
import { facebookGroupKey } from "../sources";

export const BROWSER_GRANT_MS = 3000;
/** Prepare failures that may use the bounded pre-grant retry slots. Missing reason keeps legacy retry behavior. */
export const TRANSIENT_PREPARE_REASONS = new Set([
  "loading_retryable",
  "editor_requires_focused_tab",
  "editor_text_not_accepted",
  "editor_insert_failed",
  "selection_unavailable",
  "submit_not_ready",
  "submit_not_unique_or_ready",
]);
export function mayRetryPrepareFailure(reason?: string | null) {
  if (!reason) return true;
  return TRANSIENT_PREPARE_REASONS.has(String(reason));
}
const ruleQuery = {
  where: { enabled: true, pausedReason: "", deliveryMode: "extension", browserConsent: true, browserDeviceId: { not: "" }, browserFbUserId: { not: "" } },
  include: { templates: { orderBy: { sortOrder: "asc" as const } } },
  orderBy: [{ priority: "desc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }],
};
// Only fields used by matching/delivery invalidate a checkpoint, never read/fetch timestamps.
const inputKeySql = Prisma.sql`md5(jsonb_build_array(p."textRevision",p."truncated",p."text",p."intent",p."isAd",p."forbiddenHit",p."duplicateOfId",p."dismissed",p."aiProvider",p."suggestedReply",p."postedAt",p."externalUrl",s."enabled",s."url",s."type",s."fbGroupId",s."boundCategorySlug",s."defaultProductId")::text)`;
const fingerprint = (rules: { id: string; revision: number }[]) => createHash("sha256")
  .update(JSON.stringify(rules.map(rule => [rule.id, rule.revision]))).digest("hex");
export function browserTarget(url: string, sourceUrl: string, sourceType: string, aliases: string[] = []) {
  try {
    const post = new URL(url), source = new URL(sourceUrl);
    const hosts = ["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"];
    if (sourceType !== "facebook_group" || ![post, source].every(u => u.protocol === "https:" && hosts.includes(u.hostname) && !u.username && !u.password && !u.port)) return null;
    const group = source.pathname.match(/^\/groups\/([a-zA-Z0-9._-]+)\/?$/)?.[1];
    const match = post.pathname.match(/^\/groups\/([a-zA-Z0-9._-]+)\/(?:posts|permalink)\/(\d+)\/?$/);
    const allowed = new Set([group, ...aliases].filter(Boolean).map(value => String(value).toLowerCase()));
    if (!group || !match || !allowed.has(match[1].toLowerCase()) || post.searchParams.has("comment_id") || post.searchParams.has("reply_comment_id")) return null;
    // Keep the key anchored to the configured source slug so learning a numeric alias does not rewrite durable post keys.
    const canonicalGroup = group.toLowerCase();
    return { key: `group:${canonicalGroup}:${match[2]}`, area: `group:${canonicalGroup}`, url: `https://www.facebook.com/groups/${canonicalGroup}/posts/${match[2]}/` };
  } catch { return null; }
}

async function log(tx: Prisma.TransactionClient, job: AutoCommentJob, event: string, message: string) {
  await tx.autoCommentLog.create({ data: { jobId: job.id, ruleId: job.ruleId, pageId: job.pageId, sourceId: job.sourceId, event, message } });
}
async function retryBeforeGrant(tx: Prisma.TransactionClient, job: AutoCommentJob, control: CommentControl) {
  if (job.status !== "claimed" || job.dispatchedAt || job.attempts !== 0 || !mayRun(control) || job.generation !== control.generation) return false;
  const retries = await tx.autoCommentLog.count({ where: { jobId: job.id, event: "prepare_retry" } });
  if (retries >= 2) return false;
  const nextAttemptAt = new Date(Date.now() + 30_000 * 2 ** retries);
  await tx.autoCommentJob.update({ where: { id: job.id }, data: { status: "browser_ready", claimToken: null, claimUntil: null, nextAttemptAt,
    lastError: `เตรียมหน้าไม่สำเร็จก่อนออกสิทธิ์ส่ง รอลองใหม่ครั้งที่ ${retries + 1}/2` } });
  await log(tx, job, "prepare_retry", "ยังไม่เคยออกสิทธิ์ส่ง เว้นระยะและลองเตรียมหน้าใหม่ ไม่ใช่การส่งซ้ำ");
  return true;
}
async function cancelBeforeSend(tx: Prisma.TransactionClient, job: AutoCommentJob) {
  await tx.autoCommentJob.update({ where: { id: job.id }, data: { status: "cancelled", claimToken: null, claimUntil: null, lastError: "กฎหรือโพสต์เปลี่ยนแล้ว" } });
  if (job.postId) await tx.autoCommentEvaluation.updateMany({ where: { postId: job.postId, generation: job.generation }, data: { nextEvaluateAt: new Date() } });
}
/** Keep undispatched work queued while a rule is parked or off; never cancel just because delivery is paused. */
async function holdWaitingJob(tx: Prisma.TransactionClient, job: AutoCommentJob, lastError: string) {
  if (job.dispatchedAt || !["pending", "pending_ai", "browser_ready", "claimed"].includes(job.status)) return false;
  await tx.autoCommentJob.update({
    where: { id: job.id },
    data: {
      status: job.status === "claimed" ? "browser_ready" : job.status,
      claimToken: null,
      claimUntil: null,
      lastError,
    },
  });
  return true;
}
async function dropOrHoldInvalidJob(tx: Prisma.TransactionClient, job: AutoCommentJob) {
  const rule = await tx.autoCommentRule.findUnique({ where: { id: job.ruleId }, select: { enabled: true, pausedReason: true } });
  if (rule && (!rule.enabled || rule.pausedReason) && await holdWaitingJob(tx, job, rule.pausedReason
    ? "รอคิว — กฎถูกพักชั่วคราว เปิดใหม่หลังตรวจ Facebook"
    : "รอคิว — กฎยังปิดอยู่")) return;
  await cancelBeforeSend(tx, job);
}
async function valid(tx: Prisma.TransactionClient, job: AutoCommentJob, control: CommentControl) {
  if (!mayRun(control) || job.generation !== control.generation || job.deliveryMode !== "extension") return null;
  const rule = await tx.autoCommentRule.findUnique({ where: { id: job.ruleId } });
  const post = job.postId ? await tx.post.findUnique({ where: { id: job.postId }, include: { source: true } }) : null;
  if (!rule || !post || !rule.enabled || rule.pausedReason || rule.messageMode !== "template" || !rule.browserConsent || rule.deliveryMode !== "extension" || rule.revision !== job.ruleRevision
    || rule.browserDeviceId !== job.browserDeviceId || rule.browserFbUserId !== job.browserFbUserId || !post.source.enabled
    || post.textRevision !== job.textRevision || !matchesCommentRule(rule, post)
    || browserTarget(post.externalUrl, post.source.url, post.source.type, [post.source.fbGroupId || ""].filter(Boolean))?.key !== job.postKey) return null;
  if (!await commentTypeAllowed(tx, rule.id, post.source)) return null;
  if (!await tx.extensionDevice.findFirst({ where: { id: job.browserDeviceId, revokedAt: null } })) return null;
  return { rule, post };
}

/** Only the leased worker observes posts and prepares durable browser jobs. */
export async function scanBrowserComments(assertActive: () => Promise<void>, options: { deadlineMs?: number } = {}) {
  if (process.env.MYBOT_PROCESS !== "worker") return;
  const initial = await readCommentControl(); if (!mayRun(initial)) return;
  await migrateStaleBrowserDevicePins().catch(() => undefined);
  await assertActive();
  const initialRules = await prisma.autoCommentRule.findMany(ruleQuery);
  if (!initialRules.length) return;
  // Cache only for this slice. Under the control lock, refresh the ordered
  // revision manifest for EVERY post, including live rotation counters. Admin
  // writes use the same lock and bump revision; claim/authorize still re-read.
  let cachedRules = initialRules;
  const sourceIds = [...new Set(initialRules.flatMap(rule => jsonList<string>(rule.sourceIdsJson)).filter(id => typeof id === "string" && id))];
  if (!sourceIds.length) return;
  const oldestEligibleAt = new Date(Date.now() - Math.max(...initialRules.map(rule => rule.maxAgeHours)) * 3600000).toISOString();
  const rulesFingerprint = fingerprint(initialRules);
  // Anti-join repairs checkpoints after AI/owner/source updates even when createdAt stays fixed.
  // Dates are ISO strings cast to timestamp: Prisma stores UTC without timezone;
  // binding Date as timestamptz would shift comparisons on Asia/Bangkok sessions.
  const posts = await prisma.$queryRaw<{ id: string; inputFingerprint: string }[]>(Prisma.sql`
    SELECT p."id", ${inputKeySql} AS "inputFingerprint" FROM "Post" p JOIN "Source" s ON s."id"=p."sourceId"
    LEFT JOIN "AutoCommentEvaluation" e ON e."postId"=p."id" AND e."generation"=${initial.generation}
    WHERE p."createdAt">=${initial.startedAt}::timestamp AND p."processingState"='done'
      AND p."sourceId" IN (${Prisma.join(sourceIds)})
      AND COALESCE(p."postedAt",p."createdAt")>=${oldestEligibleAt}::timestamp AND (
      e."id" IS NULL OR e."inputFingerprint"<>${inputKeySql}
      OR e."rulesFingerprint"<>${rulesFingerprint} OR e."nextEvaluateAt"<=${new Date().toISOString()}::timestamp
    ) ORDER BY e."evaluatedAt" ASC NULLS FIRST,p."createdAt" ASC,p."id" ASC LIMIT 100
  `);
  for (const candidate of posts) {
    if (Date.now() >= (options.deadlineMs ?? Infinity)) break;
    await assertActive();
    const transactionStarted = performance.now();
    try {
      await prisma.$transaction(async tx => {
        const control = await lockCommentControl(tx); if (!mayRun(control) || control.generation !== initial.generation) return;
        const lockStarted = performance.now();
        try {
          const post = await tx.post.findUnique({ where: { id: candidate.id }, include: { source: true } }); if (!post) return;
          await tx.autoCommentLog.createMany({ data: [{ eventKey: `observed:${control.generation}:${post.id}`, event: "observed", sourceId: post.sourceId }], skipDuplicates: true });
          const rulesStarted = performance.now();
          const manifest = await tx.autoCommentRule.findMany({
            where: ruleQuery.where, orderBy: ruleQuery.orderBy,
            select: { id: true, revision: true, nextTemplate: true },
          });
          if (fingerprint(manifest) !== fingerprint(cachedRules)) {
            cachedRules = await tx.autoCommentRule.findMany(ruleQuery);
          }
          const counters = new Map(manifest.map(rule => [rule.id, rule.nextTemplate]));
          const rules = cachedRules.map(rule => ({ ...rule, nextTemplate: counters.get(rule.id) ?? rule.nextTemplate }));
          recordTiming("comment_scan_rules", performance.now() - rulesStarted);
          const now = new Date();
          const reasons: { ruleId: string; codes: string[] }[] = [];
          let evaluationState = "skipped";
          let nextEvaluateAt: Date | null = null;
          for (const rule of rules) {
            // Historical generated-message rules stay inert until the owner selects templates.
            if (rule.messageMode !== "template") {
              reasons.push({ ruleId: rule.id, codes: ["no_template"] });
              continue;
            }
            const result = explainCommentRule(rule, post, now);
            const codes = result.checks.filter(check => !check.passed).map(check => check.code);
            if (!post.source.enabled) codes.push("source_disabled");
            if (!codes.includes("source") && !await commentTypeAllowed(tx, rule.id, post.source)) codes.push("type_scope");
            if (!rule.templates.length) codes.push("no_template");
            if (post.postedAt && post.postedAt < new Date(control.startedAt)) codes.push("before_start");
            const target = browserTarget(post.externalUrl, post.source.url, post.source.type, [post.source.fbGroupId || ""].filter(Boolean));
            if (!target) codes.push("unsupported_target");
            const deadline = (post.postedAt ?? post.createdAt).getTime() + rule.maxAgeHours * 3600_000;
            if (codes.includes("type_scope") && deadline > now.getTime()) nextEvaluateAt = new Date(Math.min(deadline + 1, now.getTime() + 60_000));
            // Truncated cards wait for full text so exclusions/ads hidden behind "see more" are known.
            const fatalTruncation = ["source", "source_disabled", "type_scope", "before_start", "age", "unsupported_target", "enabled", "not_paused", "not_ad", "not_forbidden", "not_duplicate", "not_dismissed", "excluded", "no_template"];
            if (post.truncated && deadline > now.getTime() && !codes.some(code => fatalTruncation.includes(code))) {
              evaluationState = "waiting_full_text";
              nextEvaluateAt = new Date(Math.min(deadline + 1, now.getTime() + 60_000));
              reasons.push({ ruleId: rule.id, codes: codes.includes("full_text") ? codes : [...codes, "full_text"] });
              break;
            }
            if (codes.length === 1 && codes[0] === "window" && deadline > now.getTime()) {
              evaluationState = "waiting_window";
              nextEvaluateAt = new Date(Math.min(deadline + 1, now.getTime() + 60_000));
            }
            reasons.push({ ruleId: rule.id, codes });
            if (codes.length || !target) continue;
            const message = rule.templates[templateIndex(rule.selectionMode, rule.templates.length, rule.nextTemplate)].body;
            const dedupeKey = `${control.dryRun ? `dry:${control.generation}` : "live"}:${target.key}`;
            const existing = await tx.autoCommentJob.findUnique({ where: { dedupeKey } });
            // Keyword bots go straight to the Extension claim queue — no AI prepare hop.
            const readyNow = !control.dryRun && Boolean(message);
            const data = { ruleId: rule.id, postId: post.id, sourceId: post.sourceId,
              externalUrl: target.url, postKey: target.key, remotePostId: "", pageId: target.area,
              deliveryMode: "extension", browserDeviceId: rule.browserDeviceId, browserFbUserId: rule.browserFbUserId,
              generation: control.generation, ruleRevision: rule.revision, textRevision: post.textRevision,
              dryRun: control.dryRun, message, status: readyNow ? "browser_ready" : "pending_ai", nextAttemptAt: now,
            };
            // Only re-evaluate cancelled work that provably never received a send grant
            // in this generation. Never clear or reuse a historical live dispatch key.
            const rearm = existing?.status === "cancelled" && existing.generation === control.generation
              && !existing.dispatchedAt && existing.attempts === 0;
            let job: AutoCommentJob;
            if (!existing) job = await tx.autoCommentJob.create({ data: { ...data, dedupeKey } });
            else if (rearm) job = await tx.autoCommentJob.update({ where: { id: existing.id }, data: {
              ...data, claimToken: null, claimUntil: null, lastError: "", nextAttemptAt: now,
            } });
            else {
              evaluationState = "deduplicated";
              reasons.push({ ruleId: rule.id, codes: ["existing_delivery", existing.status] });
              nextEvaluateAt = null;
              break;
            }
            if (rule.messageMode === "template") await tx.autoCommentRule.update({ where: { id: rule.id }, data: { nextTemplate: { increment: 1 } } });
            await log(tx, job, readyNow ? "browser_ready" : "matched", readyNow
              ? "จับคู่คำสำคัญแล้ว พร้อมให้อุปกรณ์รับงานทันที"
              : "จับคู่กฎ Extension รอการตรวจความพร้อม");
            evaluationState = "matched";
            nextEvaluateAt = null;
            break;
          }
          const checkpoint = { inputFingerprint: candidate.inputFingerprint, postUpdatedAt: post.updatedAt, sourceUpdatedAt: post.source.updatedAt,
            rulesFingerprint: fingerprint(rules), state: evaluationState, reasonsJson: JSON.stringify(reasons),
            nextEvaluateAt, evaluatedAt: now };
          await tx.autoCommentEvaluation.upsert({
            where: { generation_postId: { generation: control.generation, postId: post.id } },
            create: { postId: post.id, generation: control.generation, ...checkpoint }, update: checkpoint,
          });
        } finally { recordTiming("comment_scan_lock", performance.now() - lockStarted); }
      });
    } finally { recordTiming("comment_scan_transaction", performance.now() - transactionStarted); }
  }
}

export async function prepareBrowserComments(assertActive: () => Promise<void>, options: { deadlineMs?: number } = {}) {
  if (process.env.MYBOT_PROCESS !== "worker") return;
  await assertActive();
  const stale = await prisma.autoCommentJob.findMany({ where: { deliveryMode: "extension", status: { in: ["claimed", "sending"] }, claimUntil: { lt: new Date() } }, take: 50, select: { id: true } });
  for (const candidate of stale) {
    if (Date.now() >= (options.deadlineMs ?? Infinity)) return;
    await assertActive();
    await prisma.$transaction(async tx => {
      const control = await lockCommentControl(tx);
      const job = await tx.autoCommentJob.findFirst({ where: { id: candidate.id, deliveryMode: "extension", status: { in: ["claimed", "sending"] }, claimUntil: { lt: new Date() } } });
      if (!job) return;
      if (await retryBeforeGrant(tx, job, control)) return;
      const status = job.status === "sending" ? "uncertain" : "cancelled";
      await tx.autoCommentJob.update({ where: { id: job.id }, data: { status, claimToken: null, claimUntil: null, lastError: "Extension ขาดการติดต่อ ไม่ส่งงานนี้ซ้ำอัตโนมัติ" } });
      await log(tx, job, status, "หมดเวลางาน Extension");
      if (status === "uncertain") {
        // Ambiguous lease expiry must not freeze every other rule. Park this rule only after a burst.
        await maybePauseRuleAfterRepeatedUncertain(tx, job.ruleId);
      }
    }, { timeout: 20000, maxWait: 20000 });
  }
  // One transaction per job keeps the global control lock short on remote Postgres.
  const jobs = await prisma.autoCommentJob.findMany({ where: { deliveryMode: "extension", status: "pending_ai", nextAttemptAt: { lte: new Date() } }, take: 50, orderBy: { nextAttemptAt: "asc" }, select: { id: true } });
  for (const candidate of jobs) {
    if (Date.now() >= (options.deadlineMs ?? Infinity)) break;
    await assertActive();
    await prisma.$transaction(async tx => {
      const control = await lockCommentControl(tx); if (!mayRun(control)) return;
      const job = await tx.autoCommentJob.findFirst({ where: { id: candidate.id, status: "pending_ai", nextAttemptAt: { lte: new Date() } } }); if (!job) return;
      const state = await valid(tx, job, control);
      if (!state) {
        await dropOrHoldInvalidJob(tx, job);
        return;
      }
      const message = job.message;
      if (!message || message.length > 2000) { await tx.autoCommentJob.update({ where: { id: job.id }, data: { status: "cancelled", lastError: "ข้อความตอบว่างหรือยาวเกินกำหนด" } }); return; }
      const status = job.dryRun ? "dry_run" : "browser_ready";
      await tx.autoCommentJob.update({ where: { id: job.id }, data: { status, message, nextAttemptAt: new Date(), lastError: "" } });
      await log(tx, job, status, job.dryRun
        ? "จำลอง Extension ไม่มีการเปิดแท็บหรือกดส่ง"
        : isKeywordBotRule(state.rule)
          ? "ข้อความสำเร็จรูปพร้อมแล้ว ให้อุปกรณ์รับงานทันที"
          : "พร้อมให้อุปกรณ์ที่ผูกไว้รับงาน");
    }, { timeout: 20000, maxWait: 20000 });
  }
}

export async function claimBrowserComment(deviceId: string, fbUserId: string) {
  return prisma.$transaction(async tx => {
    const control = await lockCommentControl(tx);
    if (!mayRun(control) || control.dryRun) return null;
    if (await tx.autoCommentJob.findFirst({ where: { deliveryMode: "extension", browserDeviceId: deviceId, status: { in: ["claimed", "sending"] } } })) return null;
    const now = new Date();
    const where = { deliveryMode: "extension", browserDeviceId: deviceId, browserFbUserId: fbUserId,
      status: "browser_ready", generation: control.generation, dryRun: false, nextAttemptAt: { lte: now } };
    const globalDelay = await globalDispatchDelay(tx, control, now);
    if (globalDelay) {
      await tx.autoCommentJob.updateMany({ where, data: { nextAttemptAt: globalDelay.retryAt, lastError: globalDelay.reason } });
      return null;
    }
    const jobs = await tx.autoCommentJob.findMany({ where, include: { rule: { select: { areaCooldownSec: true } } }, orderBy: { createdAt: "asc" }, take: 30 });
    const groupDelays = new Map<string, DispatchDelay | null>();
    const postponed = new Map<string, { ids: string[]; delay: DispatchDelay }>();
    const storeDeferrals = async () => {
      for (const entry of postponed.values()) await tx.autoCommentJob.updateMany({ where: { id: { in: entry.ids }, status: "browser_ready" }, data: { nextAttemptAt: entry.delay.retryAt, lastError: entry.delay.reason } });
    };
    for (const job of jobs) {
      const key = `${job.pageId}:${job.rule.areaCooldownSec}`;
      if (!groupDelays.has(key)) groupDelays.set(key, await groupDispatchDelay(tx, job.pageId, job.rule.areaCooldownSec, now));
      const delay = groupDelays.get(key);
      if (delay) {
        const entry = postponed.get(key) ?? { ids: [], delay };
        entry.ids.push(job.id); postponed.set(key, entry);
        continue;
      }
      const state = await valid(tx, job, control);
      if (!state) { await dropOrHoldInvalidJob(tx, job); continue; }
      await storeDeferrals();
      const claimToken = randomUUID(), claimUntil = new Date(Date.now() + 120000);
      await tx.autoCommentJob.update({ where: { id: job.id }, data: { status: "claimed", claimToken, claimUntil, lastError: "" } });
      const aliases = [facebookGroupKey(state.post.source.url), state.post.source.fbGroupId || ""].filter(Boolean);
      return { id: job.id, claimToken, externalUrl: job.externalUrl, message: job.message, fbUserId: job.browserFbUserId, claimUntil: claimUntil.toISOString(), groupAliases: [...new Set(aliases)] };
    }
    await storeDeferrals();
    return null;
  }, { timeout: 10000, maxWait: 3000 });
}

/** Durable sending marker before returning a very short lived single-use click grant. */
export async function authorizeBrowserComment(deviceId: string, id: string, token: string, fbUserId: string) {
  return prisma.$transaction(async tx => {
    const control = await lockCommentControl(tx);
    const job = await tx.autoCommentJob.findFirst({ where: { id, browserDeviceId: deviceId, browserFbUserId: fbUserId, deliveryMode: "extension", status: "claimed", claimToken: token, claimUntil: { gt: new Date() } } });
    if (!job || control.dryRun || job.dryRun) return null;
    const state = await valid(tx, job, control); if (!state) { await dropOrHoldInvalidJob(tx, job); return null; }
    const defer = async (delay: DispatchDelay) => {
      await tx.autoCommentJob.update({ where: { id }, data: { status: "browser_ready", claimToken: null, claimUntil: null, nextAttemptAt: delay.retryAt, lastError: delay.reason } });
      return null;
    };
    const worker = await tx.$queryRaw<{ name: string }[]>`SELECT "name" FROM "Lease" WHERE "name"='worker' AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') + interval '5 seconds'`;
    if (!worker.length) return defer({ retryAt: new Date(Date.now() + 30000), reason: "รอ Worker พร้อม" });
    const now = new Date();
    const delay = combineDispatchDelays(await Promise.all([
      globalDispatchDelay(tx, control, now), groupDispatchDelay(tx, job.pageId, state.rule.areaCooldownSec, now),
    ]));
    if (delay) return defer(delay);
    await tx.autoCommentJob.update({ where: { id }, data: { status: "sending", attempts: { increment: 1 }, dispatchedAt: now, claimUntil: new Date(now.getTime() + 120_000) } });
    await log(tx, job, "dispatch", "อนุญาต Extension กดส่งหนึ่งครั้ง ผลไม่ชัดเจนต้องตรวจเอง");
    return { ttlMs: BROWSER_GRANT_MS, issuedAt: now.toISOString() };
  });
}

export async function reportBrowserComment(
  deviceId: string,
  id: string,
  token: string,
  outcome: "observed" | "uncertain" | "blocked" | "failed" | "not_sent",
  commentUrl?: string,
  reason?: string,
) {
  return prisma.$transaction(async tx => {
    const control = await lockCommentControl(tx);
    const job = await tx.autoCommentJob.findFirst({ where: { id, browserDeviceId: deviceId, deliveryMode: "extension", claimToken: token, status: { in: ["claimed", "sending"] } } });
    if (!job) {
      // A lost report response can be retried without changing a terminal result.
      const handled = await tx.autoCommentJob.findFirst({ where: { id, browserDeviceId: deviceId, deliveryMode: "extension" } });
      return Boolean(handled && (["browser_observed", "uncertain", "cancelled", "not_sent"].includes(handled.status)
        || (handled.status === "browser_ready" && !handled.claimToken)));
    }
    const detail = String(reason || "").trim().slice(0, 80);
    if (["failed", "not_sent"].includes(outcome) && mayRetryPrepareFailure(detail || null) && await retryBeforeGrant(tx, job, control)) return true;
    let observed = false;
    try {
      const url = new URL(commentUrl || "");
      const source = job.sourceId ? await tx.source.findUnique({ where: { id: job.sourceId }, select: { url: true, type: true, fbGroupId: true } }) : null;
      const commentId = url.searchParams.get("comment_id") || url.searchParams.get("reply_comment_id")
        || ((url.hash || "").match(/(?:comment_id|reply_comment_id)=(\d+)/) || [])[1] || "";
      observed = Boolean(source && browserTarget(url.origin + url.pathname, source.url, source.type, [source.fbGroupId || ""].filter(Boolean))?.key === job.postKey && /^\d+$/.test(commentId));
    } catch { /* no identifiable comment */ }
    const status = outcome === "not_sent" ? "not_sent"
      : outcome === "blocked" || outcome === "failed" ? "cancelled"
      : job.status === "sending" ? outcome === "observed" && observed ? "browser_observed" : "uncertain" : "cancelled";
    const reasonNote = detail ? ` (${detail})` : "";
    await tx.autoCommentJob.update({
      where: { id },
      data: {
        status,
        claimToken: null,
        claimUntil: null,
        lastError: status === "not_sent"
          ? "ส่วนขยายยืนยันว่าไม่ได้เรียกปุ่มส่ง เก็บประวัติไว้และไม่ส่งซ้ำอัตโนมัติ"
          : status === "browser_observed"
            ? "พบคอมเมนต์ในหน้าจอ ไม่ใช่การยืนยันจาก API"
            : outcome === "blocked"
              ? `เจอข้อจำกัดของ Facebook${reasonNote}`
              : `หยุดงาน ไม่ส่งซ้ำอัตโนมัติ${reasonNote}`,
      },
    });
    await log(
      tx,
      job,
      status === "uncertain" ? "uncertain" : outcome === "blocked" ? "blocked" : status,
      status === "not_sent"
        ? "สิ้นสุดก่อนเรียกปุ่มส่ง ไม่พักระบบส่วนกลาง"
        : status === "browser_observed"
          ? "Extension พบคอมเมนต์และลิงก์ใหม่ในหน้าจอ"
          : outcome === "blocked"
            ? `เจอ checkpoint หรือข้อจำกัด${reasonNote}`
            : `ต้องตรวจผลบน Facebook ด้วยตนเอง${reasonNote}`,
    );
    if (outcome === "blocked") {
      await tx.autoCommentRule.update({ where: { id: job.ruleId }, data: { pausedReason: "Extension พบข้อจำกัดของ Facebook ตรวจบัญชีก่อนเปิดใหม่" } });
      await parkWaitingJobsForPausedRule(tx, job.ruleId, "รอคิว — กฎถูกพักเพราะข้อจำกัดของ Facebook");
      if (control.state === "running") await storeCommentControl(tx, { ...control, state: "paused" });
    } else if (status === "uncertain") {
      // Keep other rules and the global Start switch running. Only park this rule after a short burst of ambiguous sends.
      await maybePauseRuleAfterRepeatedUncertain(tx, job.ruleId);
    }
    return true;
  });
}

const UNCERTAIN_BURST_LIMIT = 3;
const UNCERTAIN_BURST_WINDOW_MS = 30 * 60_000;
const WAITING_JOB_STATUSES = ["pending", "pending_ai", "browser_ready", "claimed"] as const;

/** Hold undispatched work while a rule is parked. Owner re-open resumes the same queue; never auto-resend dispatched/uncertain jobs. */
export async function parkWaitingJobsForPausedRule(tx: Prisma.TransactionClient, ruleId: string, lastError: string) {
  const claimed = await tx.autoCommentJob.updateMany({
    where: { ruleId, status: "claimed", dispatchedAt: null },
    data: { status: "browser_ready", claimToken: null, claimUntil: null, lastError },
  });
  const waiting = await tx.autoCommentJob.updateMany({
    where: { ruleId, status: { in: ["pending", "pending_ai", "browser_ready"] }, dispatchedAt: null },
    data: { lastError },
  });
  return claimed.count + waiting.count;
}

/** @deprecated Prefer parkWaitingJobsForPausedRule — kept only for callers that intentionally drop a queue. */
export async function cancelWaitingJobsForPausedRule(tx: Prisma.TransactionClient, ruleId: string, lastError: string) {
  const result = await tx.autoCommentJob.updateMany({
    where: { ruleId, status: { in: [...WAITING_JOB_STATUSES] }, dispatchedAt: null },
    data: { status: "cancelled", claimToken: null, claimUntil: null, lastError },
  });
  return result.count;
}

/** Pause only the affected rule after repeated ambiguous results; never stop the whole control plane. */
export async function maybePauseRuleAfterRepeatedUncertain(tx: Prisma.TransactionClient, ruleId: string, now = new Date()) {
  const recent = await tx.autoCommentLog.count({
    where: { ruleId, event: "uncertain", createdAt: { gte: new Date(now.getTime() - UNCERTAIN_BURST_WINDOW_MS) } },
  });
  if (recent < UNCERTAIN_BURST_LIMIT) return false;
  await tx.autoCommentRule.update({
    where: { id: ruleId },
    data: { pausedReason: "ผลไม่ชัดเจนหลายครั้งติดกัน ตรวจ Facebook ก่อนเปิดกฎนี้ใหม่ ระบบส่วนกลางยังทำงานต่อได้" },
  });
  const parked = await parkWaitingJobsForPausedRule(tx, ruleId, "รอคิว — กฎถูกพักเพราะผลไม่ชัดเจนหลายครั้ง");
  await tx.autoCommentLog.create({
    data: {
      ruleId,
      event: "rule_paused",
      message: parked
        ? `พักกฎหลัง uncertain ${recent} ครั้งใน 30 นาที และคงคิวรอ ${parked} งาน โดยไม่ Pause ทั้งระบบ`
        : `พักกฎหลัง uncertain ${recent} ครั้งใน 30 นาที โดยไม่ Pause ทั้งระบบ`,
    },
  });
  return true;
}
