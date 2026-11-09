import { RULE_ARCHIVE_PREFIX } from "./rule-archive";
import { TYPE_SETUP_PREFIX, readTypeSetup } from "./type-setup";
import { randomUUID } from "node:crypto";
import type { AutoCommentJob, AutoCommentRule, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { decryptSecret } from "../ai/secret-box";
import { commentTarget, jsonList, matchesCommentRule, templateIndex } from "./matching";
import { lockCommentControl, mayRun, readCommentControl, storeCommentControl, type CommentControl } from "./control";
import { CommentApiError, facebookGateway, type CommentCredentials, type CommentGateway } from "./facebook";

const CURSOR_KEY = "auto_comment_cursor";
const MAX_ATTEMPTS = 3;
let processing = false;
export function credentialsFor(rule: AutoCommentRule): CommentCredentials {
  try { return { pageId: rule.pageId, pageToken: decryptSecret(rule.pageTokenEnc), managerToken: decryptSecret(rule.managerTokenEnc) }; }
  catch { throw new CommentApiError("permission", "อ่าน Credential ไม่ได้ ตรวจ AI_KEY_SECRET และตั้งค่า Token ใหม่"); }
}
async function audit(tx: Prisma.TransactionClient, job: AutoCommentJob, event: string, message = "") {
  await tx.autoCommentLog.create({ data: { jobId: job.id, ruleId: job.ruleId, pageId: job.pageId, sourceId: job.sourceId, event, message } });
}

/** Durable cursor + unique jobs/logs survive restarts and concurrent workers. No network. */
export async function scanAutoCommentPosts(assertActive: () => Promise<void> = async () => undefined) {
  if (process.env.MYBOT_PROCESS !== "worker") return 0;
  const control = await readCommentControl();
  if (!mayRun(control)) return 0;
  const saved = await prisma.setting.findUnique({ where: { key: CURSOR_KEY } });
  let cursor: { generation?: string; at?: string; id?: string } = {};
  try { cursor = JSON.parse(saved?.value || "{}"); } catch { /* replay safely via unique keys */ }
  const where: Prisma.PostWhereInput = { createdAt: { gte: new Date(control.startedAt) } };
  if (cursor.generation === control.generation && cursor.at && cursor.id) where.OR = [
    { createdAt: { gt: new Date(cursor.at) } }, { createdAt: new Date(cursor.at), id: { gt: cursor.id } },
  ];
  const posts = await prisma.post.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100, select: { id: true } });
  let matched = 0;
  for (const candidate of posts) {
    await assertActive();
    const count = await prisma.$transaction(async tx => {
      const live = await lockCommentControl(tx);
      if (!mayRun(live) || live.generation !== control.generation) return 0;
      const post = await tx.post.findUnique({ where: { id: candidate.id }, include: { source: true } });
      if (!post) return 0;
      await tx.autoCommentLog.createMany({ data: [{ eventKey: `observed:${live.generation}:${post.id}`, event: "observed", sourceId: post.sourceId }], skipDuplicates: true });
      const rules = await tx.autoCommentRule.findMany({ where: { enabled: true, pausedReason: "", deliveryMode: "official" }, include: { templates: { orderBy: { sortOrder: "asc" } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      let inserted = 0;
      for (const rule of rules) {
        if (!post.source.enabled || !rule.templates.length || !matchesCommentRule(rule, post)
          || (post.postedAt && post.postedAt < new Date(live.startedAt))) continue;
        const target = commentTarget(post.externalUrl, post.source.type, rule.pageId);
        const index = templateIndex(rule.selectionMode, rule.templates.length, rule.nextTemplate);
        const dedupeKey = `${live.dryRun ? `dry:${live.generation}` : "live"}:${target.postKey}`;
        const result = await tx.autoCommentJob.createMany({ data: [{
          ruleId: rule.id, postId: post.id, sourceId: post.sourceId, externalUrl: post.externalUrl,
          dedupeKey, postKey: target.postKey, remotePostId: target.remotePostId, pageId: rule.pageId,
          generation: live.generation, ruleRevision: rule.revision, textRevision: post.textRevision,
          dryRun: live.dryRun, message: rule.templates[index].body,
          status: !target.supported ? "unsupported" : live.dryRun ? "dry_run" : "pending",
          lastError: !target.supported ? "พื้นที่นี้ไม่รองรับ Graph API สำหรับส่งอัตโนมัติ ให้เจ้าของส่งข้อความเอง" : "",
        }], skipDuplicates: true });
        if (!result.count) continue;
        inserted += 1;
        await tx.autoCommentRule.update({ where: { id: rule.id }, data: { nextTemplate: { increment: 1 } } });
        const job = await tx.autoCommentJob.findUniqueOrThrow({ where: { dedupeKey } });
        await audit(tx, job, job.status, live.dryRun ? "จำลองเท่านั้น ไม่เรียก API ส่ง" : "เข้าคิวตามกฎที่เปิดไว้");
        await tx.autoCommentLog.createMany({ data: [{ eventKey: `matched:${live.generation}:${post.id}`, event: "matched", sourceId: post.sourceId }], skipDuplicates: true });
        break; // One rule wins per post, including dry runs/unsupported drafts.
      }
      await tx.setting.upsert({ where: { key: CURSOR_KEY }, update: { value: JSON.stringify({ generation: live.generation, at: post.createdAt.toISOString(), id: post.id }) }, create: { key: CURSOR_KEY, value: JSON.stringify({ generation: live.generation, at: post.createdAt.toISOString(), id: post.id }) } });
      return inserted;
    });
    matched += count;
  }
  return matched;
}

function dayStart(now: Date) {
  const local = new Date(now.getTime() + 7 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 7 * 3600_000);
}
async function validJob(tx: Prisma.TransactionClient, job: AutoCommentJob, control: CommentControl) {
  if (!mayRun(control) || control.dryRun || job.dryRun || job.generation !== control.generation) return false;
  const rule = await tx.autoCommentRule.findUnique({ where: { id: job.ruleId } });
  const post = job.postId ? await tx.post.findUnique({ where: { id: job.postId }, include: { source: true } }) : null;
  return Boolean(rule && post && rule.revision === job.ruleRevision && post.textRevision === job.textRevision && post.source.enabled
    && matchesCommentRule(rule, post) && commentTarget(post.externalUrl, post.source.type, rule.pageId).remotePostId === job.remotePostId);
}
async function retryFailure(job: AutoCommentJob, token: string, failure: CommentApiError, alreadyDispatched: boolean) {
  await prisma.$transaction(async tx => {
    const control = await lockCommentControl(tx);
    const current = await tx.autoCommentJob.findFirst({ where: { id: job.id, claimToken: token, status: { in: ["claimed", "sending"] } } });
    if (!current) return;
    const attempts = current.attempts + (alreadyDispatched ? 0 : 1);
    const retry = ["rate", "transient"].includes(failure.kind) && attempts < MAX_ATTEMPTS;
    const status = failure.kind === "uncertain" ? "uncertain" : failure.kind === "permission" ? "permission_denied" : failure.kind === "unavailable" ? "unavailable" : retry ? "pending" : "failed";
    const delay = Math.max(30_000 * 2 ** attempts, failure.retryAfterMs);
    await tx.autoCommentJob.update({ where: { id: job.id }, data: { status, attempts, claimToken: null, claimUntil: null, lastError: failure.message, nextAttemptAt: new Date(Date.now() + delay) } });
    if (failure.kind === "permission") {
      await tx.autoCommentRule.update({ where: { id: job.ruleId }, data: { pausedReason: failure.message } });
      await storeCommentControl(tx, { ...control, state: control.state === "running" ? "paused" : control.state });
    } else if (failure.kind === "rate") {
      await storeCommentControl(tx, { ...control, cooldownUntil: new Date(Date.now() + delay).toISOString() });
    }
    await audit(tx, job, status, failure.message);
  });
}

/** A sending marker is committed BEFORE the network write; ambiguous writes never auto-retry. */
export async function processAutoCommentQueue(options: { gateway?: CommentGateway; assertActive?: () => Promise<void> } = {}) {
  if (process.env.MYBOT_PROCESS !== "worker" || processing) return 0;
  processing = true;
  const guard = options.assertActive ?? (async () => undefined);
  try {
    await guard();
    if (!mayRun(await readCommentControl())) return 0;
    await prisma.$transaction(async tx => {
      await lockCommentControl(tx);
      const stale = await tx.autoCommentJob.findMany({ where: { deliveryMode: "official", status: { in: ["claimed", "sending"] }, claimUntil: { lt: new Date() } } });
      for (const job of stale) {
        const status = job.status === "sending" ? "uncertain" : "pending";
        await tx.autoCommentJob.update({ where: { id: job.id }, data: { status, claimToken: null, claimUntil: null, lastError: status === "uncertain" ? "Worker หยุดระหว่างส่ง ต้องตรวจบน Facebook ไม่ส่งซ้ำ" : "คืนงานก่อนเริ่มส่ง" } });
        await audit(tx, job, status, "กู้คืนหลัง Worker Restart");
      }
    });
    const token = randomUUID();
    const job = await prisma.$transaction(async tx => {
      const control = await lockCommentControl(tx);
      if (!mayRun(control) || control.dryRun) return null;
      const candidate = await tx.autoCommentJob.findFirst({ where: { deliveryMode: "official", status: "pending", generation: control.generation, dryRun: false, nextAttemptAt: { lte: new Date() } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      if (!candidate) return null;
      if (!(await validJob(tx, candidate, control))) {
        await tx.autoCommentJob.update({ where: { id: candidate.id }, data: { status: "cancelled", lastError: "กฎ/โพสต์/สิทธิ์ใน Allowlist เปลี่ยนแล้ว" } });
        await audit(tx, candidate, "cancelled"); return null;
      }
      return tx.autoCommentJob.update({ where: { id: candidate.id }, data: { status: "claimed", claimToken: token, claimUntil: new Date(Date.now() + 120_000) } });
    });
    if (!job) return 0;
    let dispatched = false;
    try {
      const rule = await prisma.autoCommentRule.findUniqueOrThrow({ where: { id: job.ruleId } });
      const credentials = credentialsFor(rule);
      const gateway = options.gateway ?? facebookGateway();
      await guard();
      await gateway.verify(credentials); // App, scopes, expiry, Page identity and MODERATE task, every send.
      await guard();
      await gateway.checkPost(credentials, job.remotePostId);
      const reserved = await prisma.$transaction(async tx => {
        const control = await lockCommentControl(tx);
        const current = await tx.autoCommentJob.findFirst({ where: { id: job.id, status: "claimed", claimToken: token } });
        if (!current || !(await validJob(tx, current, control))) return false;
        const now = new Date();
        const [hourly, daily, previous] = await Promise.all([
          tx.autoCommentLog.count({ where: { event: "dispatch", createdAt: { gte: new Date(now.getTime() - 3600_000) } } }),
          tx.autoCommentLog.count({ where: { event: "dispatch", createdAt: { gte: dayStart(now) } } }),
          tx.autoCommentLog.findFirst({ where: { event: "dispatch", pageId: job.pageId }, orderBy: { createdAt: "desc" }, include: { job: { include: { rule: true } } } }),
        ]);
        const cooldown = Math.max(rule.areaCooldownSec, previous?.job?.rule.areaCooldownSec ?? 0) * 1000;
        if (hourly >= control.hourlyLimit || daily >= control.dailyLimit || (previous && now.getTime() - previous.createdAt.getTime() < cooldown)) {
          await tx.autoCommentJob.update({ where: { id: job.id }, data: { status: "pending", claimToken: null, claimUntil: null, nextAttemptAt: new Date(now.getTime() + 60_000), lastError: "รอโควตาชั่วโมง/วันหรือ Cooldown ของเพจ" } });
          return false;
        }
        await tx.autoCommentJob.update({ where: { id: job.id }, data: { status: "sending", attempts: { increment: 1 }, dispatchedAt: now } });
        await audit(tx, job, "dispatch", "จองการส่งหนึ่งครั้ง นับรวมกรณีไม่ทราบผล");
        return true;
      });
      if (!reserved) {
        await prisma.autoCommentJob.updateMany({ where: { id: job.id, status: "claimed", claimToken: token }, data: { status: "cancelled", claimToken: null, claimUntil: null } });
        return 0;
      }
      dispatched = true;
      await guard();
      // Holding the control lock until POST completes means Stop cannot acknowledge
      // and then let an already-reserved request begin afterwards.
      const sent = await prisma.$transaction(async tx => {
        const control = await lockCommentControl(tx);
        const current = await tx.autoCommentJob.findFirst({ where: { id: job.id, status: "sending", claimToken: token } });
        if (!current) return false;
        if (!(await validJob(tx, current, control))) {
          await tx.autoCommentJob.update({ where: { id: job.id }, data: { status: "cancelled", claimToken: null, claimUntil: null } });
          await audit(tx, job, "cancelled", "หยุดก่อนเริ่มคำขอส่ง"); return false;
        }
        await guard();
        const result = await gateway.send(credentials, job.remotePostId, job.message);
        await tx.autoCommentJob.update({ where: { id: job.id }, data: { status: "sent", remoteCommentId: result.id, lastError: "", claimToken: null, claimUntil: null } });
        if (result.pauseMs) await storeCommentControl(tx, { ...control, cooldownUntil: new Date(Date.now() + result.pauseMs).toISOString() });
        await audit(tx, job, "sent", "Meta คืน Comment ID แล้ว");
        return true;
      }, { timeout: 20_000, maxWait: 20_000 });
      return sent ? 1 : 0;
    } catch (error) {
      const failure = error instanceof CommentApiError ? error : new CommentApiError(dispatched ? "uncertain" : "transient", dispatched ? "การส่งหรือการบันทึกผลไม่แน่นอน ต้องตรวจด้วยมือ" : "เตรียมงานไม่สำเร็จ จะลองใหม่แบบจำกัด");
      await retryFailure(job, token, failure, dispatched);
      return 0;
    }
  } finally { processing = false; }
}

export async function autoCommentDashboard(options: {
  jobsOffset?: number;
  logsOffset?: number;
  jobsLimit?: number;
  logsLimit?: number;
} = {}) {
  const control = await readCommentControl();
  const jobsLimit = Math.min(200, Math.max(1, options.jobsLimit ?? 100));
  const logsLimit = Math.min(200, Math.max(1, options.logsLimit ?? 60));
  const jobsOffset = Math.max(0, options.jobsOffset ?? 0);
  const logsOffset = Math.max(0, options.logsOffset ?? 0);
  const [rules, sources, jobs, jobTotal, counts, observed, matched, logs, logTotal, evaluations, typeSetups, products, categories] = await Promise.all([
    prisma.autoCommentRule.findMany({ orderBy: { createdAt: "asc" }, include: { templates: { orderBy: { sortOrder: "asc" } } } }),
    prisma.source.findMany({ select: { id: true, name: true, type: true, enabled: true }, orderBy: { name: "asc" } }),
    prisma.autoCommentJob.findMany({ orderBy: { createdAt: "desc" }, skip: jobsOffset, take: jobsLimit }),
    prisma.autoCommentJob.count(),
    prisma.autoCommentJob.groupBy({ by: ["status"], _count: true }),
    prisma.autoCommentLog.count({ where: { event: "observed", createdAt: { gte: new Date(control.startedAt) } } }),
    prisma.autoCommentLog.count({ where: { event: "matched", createdAt: { gte: new Date(control.startedAt) } } }),
    prisma.autoCommentLog.findMany({ orderBy: { createdAt: "desc" }, skip: logsOffset, take: logsLimit }),
    prisma.autoCommentLog.count(),
    prisma.autoCommentEvaluation.findMany({ where: { generation: control.generation },
      orderBy: { evaluatedAt: "desc" }, take: 50,
      include: { post: { select: { text: true, externalUrl: true } } } }),
    prisma.setting.findMany({ where: { OR: [{ key: { startsWith: TYPE_SETUP_PREFIX } }, { key: { startsWith: RULE_ARCHIVE_PREFIX } }] }, select: { key: true, value: true } }),
    prisma.product.findMany({ select: { id: true, name: true, categorySlug: true } }),
    prisma.category.findMany({ where: { parentId: null }, select: { slug: true, name: true } }),
  ]);
  const archivedIds = new Set(typeSetups.filter(row => row.key.startsWith(RULE_ARCHIVE_PREFIX) && row.value === "1").map(row => row.key.slice(RULE_ARCHIVE_PREFIX.length)));
  const setupOf = new Map(typeSetups.filter(row => row.key.startsWith(TYPE_SETUP_PREFIX)).map(row => [row.key.slice(TYPE_SETUP_PREFIX.length), readTypeSetup(row.value)]));
  const productOf = new Map(products.map(row => [row.id, row]));
  const categoryOf = new Map(categories.map(row => [row.slug, row.name]));
  return {
    control, sources, logs, evaluations, jobs: jobs.map(job => ({ ...job, claimToken: undefined })),
    jobsPage: { offset: jobsOffset, limit: jobsLimit, total: jobTotal, hasMore: jobsOffset + jobs.length < jobTotal },
    logsPage: { offset: logsOffset, limit: logsLimit, total: logTotal, hasMore: logsOffset + logs.length < logTotal },
    counts: Object.fromEntries(counts.map(row => [row.status, row._count])), observed, matched,
    rules: rules.filter(rule => !archivedIds.has(rule.id)).map(({ pageTokenEnc, managerTokenEnc, ...rule }) => ({ ...rule, typeInfo: (() => { const product = productOf.get(setupOf.get(rule.id)?.productId ?? ""); return product ? { id: product.id, name: product.name, categoryName: categoryOf.get(product.categorySlug) ?? product.categorySlug } : null; })(), hasPageToken: Boolean(pageTokenEnc), hasManagerToken: Boolean(managerTokenEnc), sourceIds: jsonList<string>(rule.sourceIdsJson), days: jsonList<number>(rule.daysJson) })),
  };
}
