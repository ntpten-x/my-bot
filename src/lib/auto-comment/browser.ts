import { draftStillValid, draftKey, generateCommentDraft } from "./draft";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type AutoCommentJob } from "@prisma/client";
import { prisma } from "../prisma";
import { explainCommentRule, matchesCommentRule, templateIndex } from "./matching";
import { lockCommentControl, mayRun, readCommentControl, storeCommentControl, type CommentControl } from "./control";

export const BROWSER_GRANT_MS = 3000;
const ruleQuery = {
  where: { enabled: true, pausedReason: "", deliveryMode: "extension", browserConsent: true },
  include: { templates: { orderBy: { sortOrder: "asc" as const } } },
  orderBy: [{ priority: "desc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }],
};
// Only fields used by matching/delivery invalidate a checkpoint, never read/fetch timestamps.
const inputKeySql = Prisma.sql`md5(jsonb_build_array(p."textRevision",p."truncated",p."text",p."intent",p."isAd",p."forbiddenHit",p."duplicateOfId",p."dismissed",p."aiProvider",p."suggestedReply",p."postedAt",p."externalUrl",s."enabled",s."url",s."type")::text)`;
const fingerprint = (rules: { id: string; revision: number }[]) => createHash("sha256")
  .update(JSON.stringify(rules.map(rule => [rule.id, rule.revision]))).digest("hex");
export function browserTarget(url: string, sourceUrl: string, sourceType: string) {
  try {
    const post = new URL(url), source = new URL(sourceUrl);
    const hosts = ["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"];
    if (sourceType !== "facebook_group" || ![post, source].every(u => u.protocol === "https:" && hosts.includes(u.hostname) && !u.username && !u.password && !u.port)) return null;
    const group = source.pathname.match(/^\/groups\/([a-zA-Z0-9._-]+)\/?$/)?.[1];
    const match = post.pathname.match(/^\/groups\/([a-zA-Z0-9._-]+)\/(?:posts|permalink)\/(\d+)\/?$/);
    if (!group || !match || match[1] !== group || post.searchParams.has("comment_id") || post.searchParams.has("reply_comment_id")) return null;
    return { key: `group:${group}:${match[2]}`, area: `group:${group}`, url: `https://www.facebook.com/groups/${group}/posts/${match[2]}/` };
  } catch { return null; }
}

async function log(tx: Prisma.TransactionClient, job: AutoCommentJob, event: string, message: string) {
  await tx.autoCommentLog.create({ data: { jobId: job.id, ruleId: job.ruleId, pageId: job.pageId, sourceId: job.sourceId, event, message } });
}
async function cancelBeforeSend(tx: Prisma.TransactionClient, job: AutoCommentJob) {
  await tx.autoCommentJob.update({ where: { id: job.id }, data: { status: "cancelled", claimToken: null, claimUntil: null, lastError: "กฎหรือโพสต์เปลี่ยนแล้ว" } });
  if (job.postId) await tx.autoCommentEvaluation.updateMany({ where: { postId: job.postId, generation: job.generation }, data: { nextEvaluateAt: new Date() } });
}
async function valid(tx: Prisma.TransactionClient, job: AutoCommentJob, control: CommentControl) {
  if (!mayRun(control) || job.generation !== control.generation || job.deliveryMode !== "extension") return null;
  const rule = await tx.autoCommentRule.findUnique({ where: { id: job.ruleId } });
  const post = job.postId ? await tx.post.findUnique({ where: { id: job.postId }, include: { source: true } }) : null;
  if (!rule || !post || !rule.browserConsent || rule.deliveryMode !== "extension" || rule.revision !== job.ruleRevision
    || rule.browserDeviceId !== job.browserDeviceId || rule.browserFbUserId !== job.browserFbUserId || !post.source.enabled
    || post.textRevision !== job.textRevision || !matchesCommentRule(rule, post)
    || browserTarget(post.externalUrl, post.source.url, post.source.type)?.key !== job.postKey) return null;
  if (!await tx.extensionDevice.findFirst({ where: { id: job.browserDeviceId, revokedAt: null } })) return null;
  return { rule, post };
}
async function aiReady(tx: Prisma.TransactionClient, post: { id: string; aiProvider: string | null }) {
  if (post.aiProvider === "owner") return true;
  if (!post.aiProvider || post.aiProvider.startsWith("rules")) return false;
  return Boolean(await tx.aiJob.findFirst({ where: { postId: post.id, status: "done" } }));
}

/** Only the leased worker observes posts and prepares durable browser jobs. */
export async function scanBrowserComments(assertActive: () => Promise<void>) {
  if (process.env.MYBOT_PROCESS !== "worker") return;
  const initial = await readCommentControl(); if (!mayRun(initial)) return;
  const rulesFingerprint = fingerprint(await prisma.autoCommentRule.findMany(ruleQuery));
  // Anti-join repairs checkpoints after AI/owner/source updates even when createdAt stays fixed.
  // Dates are ISO strings cast to timestamp: Prisma stores UTC without timezone;
  // binding Date as timestamptz would shift comparisons on Asia/Bangkok sessions.
  const posts = await prisma.$queryRaw<{ id: string; inputFingerprint: string }[]>(Prisma.sql`
    SELECT p."id", ${inputKeySql} AS "inputFingerprint" FROM "Post" p JOIN "Source" s ON s."id"=p."sourceId"
    LEFT JOIN "AutoCommentEvaluation" e ON e."postId"=p."id" AND e."generation"=${initial.generation}
    WHERE p."createdAt">=${initial.startedAt}::timestamp AND (
      e."id" IS NULL OR e."inputFingerprint"<>${inputKeySql}
      OR e."rulesFingerprint"<>${rulesFingerprint} OR e."nextEvaluateAt"<=${new Date().toISOString()}::timestamp
    ) ORDER BY e."evaluatedAt" ASC NULLS FIRST,p."createdAt" ASC,p."id" ASC LIMIT 100
  `);
  for (const candidate of posts) {
    await assertActive();
    await prisma.$transaction(async tx => {
      const control = await lockCommentControl(tx); if (!mayRun(control) || control.generation !== initial.generation) return;
      const post = await tx.post.findUnique({ where: { id: candidate.id }, include: { source: true } }); if (!post) return;
      await tx.autoCommentLog.createMany({ data: [{ eventKey: `observed:${control.generation}:${post.id}`, event: "observed", sourceId: post.sourceId }], skipDuplicates: true });
      const rules = await tx.autoCommentRule.findMany(ruleQuery);
      const now = new Date();
      const reasons: { ruleId: string; codes: string[] }[] = [];
      let evaluationState = "skipped";
      let nextEvaluateAt: Date | null = null;
      let classificationReady: boolean | undefined;
      for (const rule of rules) {
        const result = explainCommentRule(rule, post, now);
        const codes = result.checks.filter(check => !check.passed).map(check => check.code);
        if (!post.source.enabled) codes.push("source_disabled");
        if (rule.messageMode !== "ai_draft" && !rule.templates.length) codes.push("no_template");
        if (post.postedAt && post.postedAt < new Date(control.startedAt)) codes.push("before_start");
        const target = browserTarget(post.externalUrl, post.source.url, post.source.type);
        if (!target) codes.push("unsupported_target");
        const deadline = (post.postedAt ?? post.createdAt).getTime() + rule.maxAgeHours * 3600_000;
        // Keep a durable wait even if pre-AI labels initially reject the post.
        if (post.truncated && deadline > now.getTime() && !codes.some(code => ["source", "source_disabled", "before_start", "age", "unsupported_target"].includes(code))) {
          evaluationState = "waiting_full_text";
          nextEvaluateAt = new Date(Math.min(deadline + 1, now.getTime() + 60_000));
          reasons.push({ ruleId: rule.id, codes: ["full_text"] });
          break;
        }
        const aiRelevant = rule.requireAi && codes.every(code => ["not_ad", "intent", "window"].includes(code));
        const waitingAi = aiRelevant && !(classificationReady ??= await aiReady(tx, post));
        if (waitingAi && deadline > now.getTime() && codes.every(code => ["not_ad", "intent", "window"].includes(code))) {
          evaluationState = "waiting_ai";
          nextEvaluateAt = new Date(Math.min(deadline + 1, now.getTime() + 30_000));
        } else if (codes.length === 1 && codes[0] === "window" && deadline > now.getTime()) {
          evaluationState = "waiting_window";
          nextEvaluateAt = new Date(Math.min(deadline + 1, now.getTime() + 60_000));
        }
        reasons.push({ ruleId: rule.id, codes: waitingAi ? [...codes, "waiting_ai"] : codes });
        // A higher-priority applicable rule waiting for classification must not
        // lose its post to a lower-priority keyword-only rule.
        if (evaluationState === "waiting_ai" && codes.length && codes.every(code => ["not_ad", "intent", "window"].includes(code))) break;
        if (codes.length || !target) continue;
        const message = rule.messageMode === "ai_draft" ? "" : rule.templates[templateIndex(rule.selectionMode, rule.templates.length, rule.nextTemplate)].body;
        const dedupeKey = `${control.dryRun ? `dry:${control.generation}` : "live"}:${target.key}`;
        const existing = await tx.autoCommentJob.findUnique({ where: { dedupeKey } });
        const data = { ruleId: rule.id, postId: post.id, sourceId: post.sourceId,
          externalUrl: target.url, postKey: target.key, remotePostId: "", pageId: target.area,
          deliveryMode: "extension", browserDeviceId: rule.browserDeviceId, browserFbUserId: rule.browserFbUserId,
          generation: control.generation, ruleRevision: rule.revision, textRevision: post.textRevision,
          dryRun: control.dryRun, message, status: "pending_ai",
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
          evaluationState = waitingAi && existing.status === "pending_ai" ? "waiting_ai" : "deduplicated";
          reasons.push({ ruleId: rule.id, codes: ["existing_delivery", existing.status] });
          if (evaluationState !== "waiting_ai") nextEvaluateAt = null;
          break;
        }
        if (rule.messageMode === "template") await tx.autoCommentRule.update({ where: { id: rule.id }, data: { nextTemplate: { increment: 1 } } });
        await log(tx, job, "matched", "จับคู่กฎ Extension รอการตรวจความพร้อม");
        evaluationState = waitingAi ? "waiting_ai" : "matched";
        if (!waitingAi) nextEvaluateAt = null;
        break;
      }
      const checkpoint = { inputFingerprint: candidate.inputFingerprint, postUpdatedAt: post.updatedAt, sourceUpdatedAt: post.source.updatedAt,
        rulesFingerprint: fingerprint(rules), state: evaluationState, reasonsJson: JSON.stringify(reasons),
        nextEvaluateAt, evaluatedAt: now };
      await tx.autoCommentEvaluation.upsert({
        where: { generation_postId: { generation: control.generation, postId: post.id } },
        create: { postId: post.id, generation: control.generation, ...checkpoint }, update: checkpoint,
      });
    });
  }
}

export async function prepareBrowserComments(assertActive: () => Promise<void>) {
  if (process.env.MYBOT_PROCESS !== "worker") return;
  await assertActive();
  const stale = await prisma.autoCommentJob.findMany({ where: { deliveryMode: "extension", status: { in: ["claimed", "sending"] }, claimUntil: { lt: new Date() } }, take: 50, select: { id: true } });
  for (const candidate of stale) {
    await assertActive();
    await prisma.$transaction(async tx => {
      const control = await lockCommentControl(tx);
      const job = await tx.autoCommentJob.findFirst({ where: { id: candidate.id, deliveryMode: "extension", status: { in: ["claimed", "sending"] }, claimUntil: { lt: new Date() } } });
      if (!job) return;
      const status = job.status === "sending" ? "uncertain" : "cancelled";
      await tx.autoCommentJob.update({ where: { id: job.id }, data: { status, claimToken: null, claimUntil: null, lastError: "Extension ขาดการติดต่อ ไม่ส่งงานนี้ซ้ำอัตโนมัติ" } });
      await log(tx, job, status, "หมดเวลางาน Extension");
      if (status === "uncertain") {
        await tx.autoCommentRule.update({ where: { id: job.ruleId }, data: { pausedReason: "ขาดการติดต่อระหว่างส่ง ต้องตรวจ Facebook เองก่อนเปิดกฎใหม่" } });
        if (control.state === "running") await storeCommentControl(tx, { ...control, state: "paused" });
      }
    }, { timeout: 20000, maxWait: 20000 });
  }
  // One transaction per job keeps the global control lock short on remote Postgres.
  const jobs = await prisma.autoCommentJob.findMany({ where: { deliveryMode: "extension", status: "pending_ai", nextAttemptAt: { lte: new Date() } }, take: 50, orderBy: { nextAttemptAt: "asc" }, select: { id: true } });
  for (const candidate of jobs) {
    await assertActive();
    const draft = await prisma.$transaction(async tx => {
      const control = await lockCommentControl(tx); if (!mayRun(control)) return;
      const job = await tx.autoCommentJob.findFirst({ where: { id: candidate.id, status: "pending_ai", nextAttemptAt: { lte: new Date() } } }); if (!job) return;
      const state = await valid(tx, job, control);
      if (!state) {
        await cancelBeforeSend(tx, job);
        return;
      }
      if (state.rule.requireAi && !await aiReady(tx, state.post)) {
        await tx.autoCommentJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() + 30000) } });
        return;
      }
      if (state.rule.messageMode === "ai_draft" && !draftStillValid(job, state.rule, state.post)) return { job, ...state };
      const message = job.message;
      if (!message || message.length > 2000) { await tx.autoCommentJob.update({ where: { id: job.id }, data: { status: "cancelled", lastError: "ข้อความตอบว่างหรือยาวเกินกำหนด" } }); return; }
      const status = job.dryRun ? "dry_run" : "browser_ready";
      await tx.autoCommentJob.update({ where: { id: job.id }, data: { status, message } });
      await log(tx, job, status, job.dryRun ? "จำลอง Extension ไม่มีการเปิดแท็บหรือกดส่ง" : "พร้อมให้อุปกรณ์ที่ผูกไว้รับงาน");
    }, { timeout: 20000, maxWait: 20000 });
    if (draft) {
      await assertActive();
      try {
        const result = await generateCommentDraft(draft.rule, draft.post, assertActive);
        await prisma.$transaction(async tx => {
          const control = await lockCommentControl(tx);
          const current = await tx.autoCommentJob.findFirst({ where: { id: draft.job.id, status: "pending_ai" } });
          if (!current) return;
          const state = await valid(tx, current, control);
          if (!state || result.key !== draftKey(state.rule, state.post)) { await cancelBeforeSend(tx, current); return; }
          await tx.autoCommentJob.update({ where: { id: current.id }, data: { message: result.message, draftInputKey: result.key, draftProvider: result.provider, status: current.dryRun ? "dry_run" : "browser_ready", nextAttemptAt: new Date(), lastError: "" } });
        });
      } catch {
        await prisma.autoCommentJob.updateMany({ where: { id: draft.job.id, status: "pending_ai", ruleRevision: draft.job.ruleRevision, textRevision: draft.job.textRevision }, data: { nextAttemptAt: new Date(Date.now() + 60_000), lastError: "AI Draft ยังไม่ผ่าน ตรวจข้อมูลธุรกิจ/provider จะประเมินใหม่ก่อนหมดอายุโพสต์" } });
      }
    }
  }
}

export async function claimBrowserComment(deviceId: string, fbUserId: string) {
  return prisma.$transaction(async tx => {
    const control = await lockCommentControl(tx);
    if (!mayRun(control) || control.dryRun) return null;
    if (await tx.autoCommentJob.findFirst({ where: { deliveryMode: "extension", browserDeviceId: deviceId, status: { in: ["claimed", "sending"] } } })) return null;
    const job = await tx.autoCommentJob.findFirst({ where: { deliveryMode: "extension", browserDeviceId: deviceId, browserFbUserId: fbUserId,
      status: "browser_ready", generation: control.generation, dryRun: false, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" } });
    if (!job) return null;
    if (!await valid(tx, job, control)) { await cancelBeforeSend(tx, job); return null; }
    const claimToken = randomUUID(), claimUntil = new Date(Date.now() + 120_000);
    await tx.autoCommentJob.update({ where: { id: job.id }, data: { status: "claimed", claimToken, claimUntil } });
    return { id: job.id, claimToken, externalUrl: job.externalUrl, message: job.message, fbUserId: job.browserFbUserId, claimUntil: claimUntil.toISOString() };
  });
}

/** Durable sending marker before returning a very short lived single-use click grant. */
export async function authorizeBrowserComment(deviceId: string, id: string, token: string, fbUserId: string) {
  return prisma.$transaction(async tx => {
    const control = await lockCommentControl(tx);
    const job = await tx.autoCommentJob.findFirst({ where: { id, browserDeviceId: deviceId, browserFbUserId: fbUserId, deliveryMode: "extension", status: "claimed", claimToken: token, claimUntil: { gt: new Date() } } });
    if (!job || control.dryRun || job.dryRun) return null;
    const state = await valid(tx, job, control); if (!state) { await cancelBeforeSend(tx, job); return null; }
    const worker = await tx.$queryRaw<{ name: string }[]>`SELECT "name" FROM "Lease" WHERE "name"='worker' AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') + interval '5 seconds'`;
    if (!worker.length) return null;
    if (state.rule.requireAi && !await aiReady(tx, state.post)) return null;
    if (state.rule.messageMode === "ai_draft" && !draftStillValid(job, state.rule, state.post)) return null;
    const defer = () => tx.autoCommentJob.update({ where: { id }, data: { status: "browser_ready", claimToken: null, claimUntil: null, nextAttemptAt: new Date(Date.now() + 60000) } });
    if (await tx.autoCommentJob.findFirst({ where: { deliveryMode: "extension", status: "sending", claimUntil: { gt: new Date() } } })) { await defer(); return null; }
    const now = new Date(), local = new Date(now.getTime() + 7 * 3600_000);
    const dayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 7 * 3600_000);
    const [hour, day, previous] = await Promise.all([
      tx.autoCommentLog.count({ where: { event: "dispatch", createdAt: { gte: new Date(now.getTime() - 3600_000) } } }),
      tx.autoCommentLog.count({ where: { event: "dispatch", createdAt: { gte: dayStart } } }),
      tx.autoCommentLog.findFirst({ where: { event: "dispatch", pageId: job.pageId }, orderBy: { createdAt: "desc" }, include: { job: { include: { rule: true } } } }),
    ]);
    if (hour >= control.hourlyLimit || day >= control.dailyLimit || (previous && now.getTime() - previous.createdAt.getTime() < Math.max(state.rule.areaCooldownSec, previous.job?.rule.areaCooldownSec ?? 0) * 1000)) { await defer(); return null; }
    await tx.autoCommentJob.update({ where: { id }, data: { status: "sending", attempts: { increment: 1 }, dispatchedAt: now, claimUntil: new Date(now.getTime() + 120_000) } });
    await log(tx, job, "dispatch", "อนุญาต Extension กดส่งหนึ่งครั้ง ผลไม่ชัดเจนต้องตรวจเอง");
    return { ttlMs: BROWSER_GRANT_MS, issuedAt: now.toISOString() };
  });
}

export async function reportBrowserComment(deviceId: string, id: string, token: string, outcome: "observed" | "uncertain" | "blocked" | "failed", commentUrl?: string) {
  return prisma.$transaction(async tx => {
    const control = await lockCommentControl(tx);
    const job = await tx.autoCommentJob.findFirst({ where: { id, browserDeviceId: deviceId, deliveryMode: "extension", claimToken: token, status: { in: ["claimed", "sending"] } } });
    if (!job) return false;
    let observed = false;
    try { const url = new URL(commentUrl || ""); observed = browserTarget(url.origin + url.pathname, job.externalUrl.replace(/\/(?:posts|permalink)\/\d+\/?$/, ""), "facebook_group")?.key === job.postKey && /^\d+$/.test(url.searchParams.get("comment_id") || ""); } catch { /* no identifiable comment */ }
    const status = job.status === "sending" ? outcome === "observed" && observed ? "browser_observed" : "uncertain" : "cancelled";
    await tx.autoCommentJob.update({ where: { id }, data: { status, claimToken: null, claimUntil: null, lastError: status === "browser_observed" ? "พบคอมเมนต์ในหน้าจอ ไม่ใช่การยืนยันจาก API" : "หยุดงาน ไม่ส่งซ้ำอัตโนมัติ" } });
    await log(tx, job, status, status === "browser_observed" ? "Extension พบคอมเมนต์และลิงก์ใหม่ในหน้าจอ" : "ต้องตรวจผลบน Facebook ด้วยตนเอง");
    if (outcome === "blocked" || status === "uncertain") {
      await tx.autoCommentRule.update({ where: { id: job.ruleId }, data: { pausedReason: "Extension พบข้อจำกัดหรือผลไม่ชัดเจน ตรวจ Facebook ก่อนเปิดใหม่" } });
      if (control.state === "running") await storeCommentControl(tx, { ...control, state: "paused" });
    }
    return true;
  });
}
