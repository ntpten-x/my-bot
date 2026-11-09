import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import { getSettings } from "../settings";
import { loadCatalogFromDb, resolveCategoryIds } from "../sources";
import { classifyLeads } from "./run";
import { ProviderHttpError, backoffMs } from "./bucket";
import { ocrPostImages } from "../ocr";
import { enrichPosts } from "../smart/enrich";
import { shouldNotifyExternal } from "../notify";
import { queueExternalNotification } from "../notification-queue";
import { workerLog } from "../log";
import { applyAutomationRules } from "../automation";
import { inServiceArea } from "../service-area";
import { scoreAd } from "../pipeline/ad-filter";
import { ruleItem, type AiItem } from "../pipeline/classify-rules";
import { syncDuplicateLabels } from "../smart/duplicate-labels";
import { promptContextVersion, setOwnerExamples, setProductList } from "./prompt";
import { assignProducts, loadProducts } from "../products";
import { productPrompt } from "../pipeline/products";
import { loadGroupHints } from "../group-profiles";

/** Ad score at which a post is plainly an ad: rules label it and the model is not called. */
export const OBVIOUS_AD_SCORE = 4;

async function loadOwnerExamples() {
  const rows = await prisma.post.findMany({
    where: { aiProvider: "owner", categoryId: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 6,
    select: { text: true, category: { select: { slug: true } }, subcategory: { select: { slug: true } } },
  });
  setOwnerExamples(rows.map((row) => ({ text: row.text, label: [row.category?.slug, row.subcategory?.slug].filter(Boolean).join("/") })));
}

export const STUCK_JOB_MS = 2 * 60 * 1000;
export const MAX_AI_ATTEMPTS = 10;
let running = false;

// Startup preserves backoff and paused jobs. Only an explicit retry resets them.
export async function enqueueAiJobs(postIds: string[], reset = false) {
  const settings = await getSettings();
  const rulesOnly = settings.aiProvider === "rules";
  const status = rulesOnly ? "skipped" : "pending";
  const lastError = rulesOnly ? "ใช้กฎ ไม่เรียก AI" : "";
  for (const postId of postIds) {
    if (reset && !rulesOnly) await prisma.aiJob.updateMany({
      where: { postId, status: { not: "running" } },
      data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: "", latencyMs: null, queueWaitMs: null, createdAt: new Date() },
    });
    await prisma.aiJob.upsert({
      where: { postId },
      update: rulesOnly ? { status: "skipped", claimToken: null, lastError } : {},
      create: { postId, status, lastError },
    });
  }
}

export async function enqueueUnclassifiedPosts(reset = false) {
  const settings = await getSettings();
  if (settings.aiProvider === "rules") return 0;
  let cursor: string | undefined;
  let count = 0;
  for (;;) {
    const posts = await prisma.post.findMany({
      where: { duplicateOfId: null, aiJobs: { none: { status: "running" } }, OR: [{ aiProvider: null }, { aiProvider: "rules" }] },
      select: { id: true }, orderBy: { id: "asc" }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!posts.length) break;
    await enqueueAiJobs(posts.map(post => post.id), reset);
    count += posts.length;
    cursor = posts[posts.length - 1].id;
  }
  return count;
}

/** Bounded online repair for a crash between legacy Post insertion and enqueue. */
export async function repairMissingAiJobs(limit = 100) {
  const rows = await prisma.post.findMany({ where: { duplicateOfId: null, OR: [{ aiProvider: null }, { aiProvider: { not: "owner" } }], aiJobs: { none: {} } }, select: { id: true }, take: limit, orderBy: { createdAt: "asc" } });
  await enqueueAiJobs(rows.map(row => row.id));
  return rows.length;
}

export async function claimAiJobs(claimToken: string, db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma) {
  return db.$queryRaw<{ id: string }[]>`
      UPDATE "AiJob" SET "status" = 'running', "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC'), "claimToken" = ${claimToken}
      WHERE "id" IN (
        SELECT "id" FROM "AiJob"
        WHERE "status" = 'pending' AND "nextAttemptAt" <= (clock_timestamp() AT TIME ZONE 'UTC')
        ORDER BY "nextAttemptAt" ASC, "id" ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"`;
}

export async function processAiQueue(assertActive: () => Promise<void> = async () => undefined) {
  if (process.env.MYBOT_PROCESS !== "worker" || running) return 0;
  running = true;
  const claimToken = randomUUID();
  let claimed: { id: string; postId: string; attempts: number }[] = [];
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const retry = async (job: typeof claimed[number], message: string, delay = 0, latencyMs?: number, attempted = true) => {
    const attempts = job.attempts + (attempted ? 1 : 0);
    const status = attempted && attempts >= MAX_AI_ATTEMPTS ? "failed" : "pending";
    const updated = await prisma.aiJob.updateMany({
      where: { id: job.id, status: "running", claimToken },
      data: { status, claimToken: null, attempts, nextAttemptAt: new Date(Date.now() + (attempted ? Math.max(delay, backoffMs(job.attempts)) : Math.max(1000, delay || 60_000))), lastError: message.slice(0, 500), latencyMs: attempted ? latencyMs : null },
    });
    if (!updated.count) return;
    await workerLog({ level: attempted ? "error" : "info", jobId: job.id, postId: job.postId, message: !attempted ? "รอผู้ให้บริการ AI พร้อม โดยไม่เพิ่มจำนวนครั้งล้มเหลว" : status === "failed" ? "พักงาน AI หลังผิดซ้ำ กดลองใหม่ได้ที่แดชบอร์ด" : "คืนงาน AI เพื่อรอลองใหม่", error: message.slice(0, 500), latencyMs: attempted ? latencyMs : undefined });
  };
  try {
    await assertActive();
    const settings = await getSettings();
    await prisma.aiJob.updateMany({
      where: { status: "running", updatedAt: { lt: new Date(Date.now() - STUCK_JOB_MS) } },
      data: { status: "pending", claimToken: null, nextAttemptAt: new Date(), lastError: "worker หยุดตอบเกิน 2 นาที จึงคืนเข้าคิว" },
    });
    await prisma.aiJob.updateMany({
      where: { status: { in: ["pending", "skipped"] }, post: { aiProvider: "owner" } },
      data: { status: "skipped", claimToken: null, lastError: "เจ้าของจัดหมวดเอง ไม่เรียก AI ทับ" },
    });
    if (settings.aiProvider === "rules") {
      const cleared = await prisma.aiJob.updateMany({
        where: { status: { in: ["pending", "running"] }, post: { aiProvider: { not: "owner" } } },
        data: { status: "skipped", claimToken: null, lastError: "ใช้กฎ ไม่เรียก AI" },
      });
      return cleared.count;
    }
    await prisma.aiJob.updateMany({ where: { status: "skipped", post: { duplicateOfId: null, OR: [{ aiProvider: null }, { aiProvider: { not: "owner" } }] } }, data: { status: "pending", nextAttemptAt: new Date() } });
    await prisma.aiJob.updateMany({ where: { status: "pending", post: { duplicateOfId: { not: null } } }, data: { status: "skipped", claimToken: null, lastError: "โพสต์ซ้ำ ใช้ผลจากต้นฉบับ" } });
    // Atomic claim: two instances (local + Render) never take the same job.
    const claimedIds = await claimAiJobs(claimToken);
    const jobs = claimedIds.length
      ? await prisma.aiJob.findMany({
        where: { id: { in: claimedIds.map(row => row.id) }, claimToken },
        orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], include: { post: { include: { source: { select: { type: true } } } } },
      })
      : [];
    if (!jobs.length) return 0;
    claimed = jobs;
    const started = Date.now();
    await Promise.all(jobs.map(job => prisma.aiJob.updateMany({ where: { id: job.id, claimToken }, data: { queueWaitMs: Math.min(2_147_483_647, Math.max(0, started - job.createdAt.getTime())) } })));
    heartbeat = setInterval(() => {
      void assertActive().then(() => prisma.aiJob.updateMany({ where: { id: { in: claimed.map(job => job.id) }, status: "running", claimToken }, data: { updatedAt: new Date() } })).catch(() => undefined);
    }, 30_000);
    heartbeat.unref();
    const [{ rows, catalog }, hints] = await Promise.all([
      loadCatalogFromDb(),
      loadGroupHints(jobs.map(job => job.post.sourceId)).catch(() => new Map()),
      loadOwnerExamples().catch(() => undefined),
      loadProducts().then((list) => setProductList(productPrompt(list))).catch(() => undefined),
    ]);
    const inputs = [];
    const adItems: AiItem[] = [];
    for (const job of jobs) {
      // Plain ads skip the model: rules are enough and it saves several seconds per batch.
      if (job.post.source?.type !== "facebook_marketplace" && scoreAd(job.post.text).score >= OBVIOUS_AD_SCORE) {
        adItems.push({ ...ruleItem({ id: job.postId, text: job.post.text, groupHint: hints.get(job.post.sourceId) ?? null }, catalog), isAd: true, intent: "ad" });
        continue;
      }
      let ocrText = job.post.ocrText;
      if (settings.ocrEnabled && !ocrText) {
        try {
          const parsed: unknown = JSON.parse(job.post.imagesJson);
          ocrText = await ocrPostImages(Array.isArray(parsed) ? parsed.map(String) : [], settings);
          if (ocrText) await prisma.post.updateMany({ where: { id: job.postId, textRevision: job.post.textRevision, aiJobs: { some: { claimToken, status: "running" } } }, data: { ocrText } });
        } catch {
          await workerLog({ level: "error", jobId: job.id, postId: job.postId, message: "OCR ล้มเหลว จะจัดหมวดต่อโดยไม่มีข้อความจากรูป" });
        }
      }
      inputs.push({ id: job.postId, text: ocrText ? `${job.post.text}\n${ocrText}` : job.post.text, contentHash: `${job.post.contentHash}:${ocrText ? "ocr:" : ""}${promptContextVersion()}:${JSON.stringify(hints.get(job.post.sourceId) ?? null)}`, groupHint: hints.get(job.post.sourceId) ?? null });
    }
    const outcome = await classifyLeads(inputs, catalog, settings, {
      async get(key) {
        const row = await prisma.aiCache.findUnique({ where: { cacheKey: key } });
        if (!row || row.provider === "rules") return null;
        try { return { provider: row.provider, item: JSON.parse(row.result) }; } catch { return null; }
      },
      async set(key, hit) {
        await prisma.aiCache.upsert({ where: { cacheKey: key }, update: { provider: hit.provider, result: JSON.stringify(hit.item) }, create: { cacheKey: key, provider: hit.provider, result: JSON.stringify(hit.item) } });
      },
    });
    for (const item of adItems) outcome.providersById[item.id] = "rules:ad";
    const successful = [...outcome.results.filter(item => outcome.providersById[item.id] && outcome.providersById[item.id] !== "rules"), ...adItems];
    const marketplaceIds = new Set(jobs.filter(job => job.post.source?.type === "facebook_marketplace").map(job => job.postId));
    const completed: AiItem[] = [];
    for (const item of successful) {
      await assertActive();
      const job = jobs.find(job => job.postId === item.id)!;
      const ids = resolveCategoryIds(rows, item.categorySlug, item.subcategorySlug);
      if (marketplaceIds.has(item.id)) Object.assign(item, { intent: "seller", isAd: false });
      const committed = await prisma.$transaction(async tx => {
        // Lock post before job, the same order as ingestion's revision transaction.
        const updated = await tx.post.updateMany({
          where: { id: item.id, textRevision: job.post.textRevision, OR: [{ aiProvider: null }, { aiProvider: { not: "owner" } }], aiJobs: { some: { claimToken, status: "running" } } },
          data: { categoryId: ids.categoryId, subcategoryId: ids.subcategoryId, intent: item.intent, province: item.province, isAd: item.isAd, suggestedReply: item.suggestedReply, aiProvider: outcome.providersById[item.id] },
        });
        if (!updated.count) return false;
        const done = await tx.aiJob.updateMany({ where: { id: job.id, claimToken, status: "running" }, data: { status: "done", claimToken: null, lastError: "", latencyMs: Date.now() - started } });
        if (!done.count) throw new Error("AI claim superseded");
        return true;
      });
      if (committed) completed.push(item);
    }
    const revisions = new Map(jobs.map(job => [job.postId, job.post.textRevision]));
    await assertActive();
    await assignProducts(completed.map(item => item.id), new Map(completed.map(item => [item.id, item.productSlug ?? null])), revisions).catch((error) => console.error("[products]", error));
    await enrichPosts(completed.map(item => item.id), completed, settings, { embed: false, revisions });
    const successIds = new Set(completed.map(item => item.id));
    const retryErrors = outcome.errors.filter(error => !error.message.startsWith("ข้าม "));
    const errorText = retryErrors.map(error => `${error.name}: ${error.message}`).join("; ") || (outcome.attemptedIds?.length === 0 ? "ยังไม่มีผู้ให้บริการพร้อมตามการตั้งค่าและโควตา" : "AI ตอบไม่ครบ ยังไม่ได้ผลของโพสต์นี้");
    const delay = Math.max(0, ...retryErrors.map(error => "retryAfterMs" in error ? Number(error.retryAfterMs) || 0 : 0));
    for (const job of jobs) {
      const latencyMs = Date.now() - started;
      if (successIds.has(job.postId)) {
        await workerLog({ jobId: job.id, postId: job.postId, provider: outcome.providersById[job.postId], latencyMs, message: "จัดหมวดแล้ว" });
      } else {
        const attempted = !outcome.attemptedIds || outcome.attemptedIds.includes(job.postId);
        const wait = attempted ? delay : Math.max(0, (outcome.retryAt || Date.now() + 60_000) - Date.now());
        await retry(job, attempted ? errorText : `รอผู้ให้บริการ AI: ${errorText}`, wait, latencyMs, attempted);
      }
    }
    claimed = [];
    await assertActive();
    await syncDuplicateLabels().catch(error => workerLog({ level: "error", message: "คัดลอกหมวดให้โพสต์ซ้ำไม่สำเร็จ", error: String(error).slice(0, 300) }));
    await applyAutomationRules([...successIds]).catch(error => workerLog({ level: "error", message: "ใช้กฎอัตโนมัติไม่สำเร็จ", error: String(error).slice(0, 300) }));
    const ready = await prisma.post.findMany({ where: { id: { in: [...successIds] }, duplicateOfId: null, dismissed: false }, include: { category: true, subcategory: true, source: true } });
    for (const post of ready) {
      if (post.score < 80 || !shouldNotifyExternal(post)) continue;
      if (settings.serviceAreaNotifyOnly && !inServiceArea(post.province, settings.serviceProvinces)) continue;
      const already = await prisma.notification.count({ where: { postId: post.id, channel: { in: ["discord", "line", "email"] } } });
      if (!already) await queueExternalNotification(post.id, "ลีดร้อน");
    }
    return jobs.length;
  } catch (error) {
    try { await assertActive(); } catch { return 0; }
    const message = error instanceof Error ? error.message : "จัดหมวดไม่สำเร็จ";
    for (const job of claimed) {
      await retry(job, message, error instanceof ProviderHttpError ? error.retryAfterMs : 0).catch(() => undefined);
    }
    await workerLog({ level: "error", message: "รอบคิว AI ล้มเหลว", error: message.slice(0, 500) });
    return 0;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    running = false;
  }
}
