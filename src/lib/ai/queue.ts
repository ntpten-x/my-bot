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
import { setOwnerExamples, setProductList } from "./prompt";
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
  for (const postId of postIds) {
    if (reset) await prisma.aiJob.updateMany({
      where: { postId, status: { not: "running" } },
      data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: "", latencyMs: null, queueWaitMs: null, createdAt: new Date() },
    });
    await prisma.aiJob.upsert({
      where: { postId },
      update: {},
      create: { postId, status: "pending" },
    });
  }
}

export async function enqueueUnclassifiedPosts(reset = false) {
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

export async function processAiQueue(assertActive: () => Promise<void> = async () => undefined) {
  if (process.env.MYBOT_PROCESS !== "worker" || running) return 0;
  running = true;
  const claimToken = randomUUID();
  let claimed: { id: string; postId: string; attempts: number }[] = [];
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const retry = async (job: typeof claimed[number], message: string, delay = 0, latencyMs?: number) => {
    const attempts = job.attempts + 1;
    const status = attempts >= MAX_AI_ATTEMPTS ? "failed" : "pending";
    const updated = await prisma.aiJob.updateMany({
      where: { id: job.id, status: "running", claimToken },
      data: { status, claimToken: null, attempts, nextAttemptAt: new Date(Date.now() + Math.max(delay, backoffMs(job.attempts))), lastError: message.slice(0, 500), latencyMs },
    });
    if (!updated.count) return;
    await workerLog({ level: "error", jobId: job.id, postId: job.postId, message: status === "failed" ? "พักงาน AI หลังผิดซ้ำ กดลองใหม่ได้ที่แดชบอร์ด" : "คืนงาน AI เพื่อรอลองใหม่", error: message.slice(0, 500), latencyMs });
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
    if (settings.aiProvider !== "rules") {
      await prisma.aiJob.updateMany({ where: { status: "skipped", post: { OR: [{ aiProvider: null }, { aiProvider: { not: "owner" } }] } }, data: { status: "pending", nextAttemptAt: new Date() } });
    }
    // Atomic claim: two instances (local + Render) never take the same job.
    const claimedIds = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "AiJob" SET "status" = 'running', "updatedAt" = now(), "claimToken" = ${claimToken}
      WHERE "id" IN (
        SELECT "id" FROM "AiJob"
        WHERE "status" = 'pending' AND "nextAttemptAt" <= ${new Date()}
        ORDER BY "nextAttemptAt" ASC, "id" ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"`;
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
    if (settings.aiProvider === "rules") {
      await prisma.aiJob.updateMany({ where: { id: { in: jobs.map(job => job.id) }, claimToken }, data: { status: "skipped", claimToken: null, lastError: "เจ้าของเลือกใช้กฎ ไม่เรียก AI" } });
      claimed = [];
      return jobs.length;
    }
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
      inputs.push({ id: job.postId, text: ocrText ? `${job.post.text}\n${ocrText}` : job.post.text, contentHash: ocrText ? `${job.post.contentHash}:ocr` : job.post.contentHash, groupHint: hints.get(job.post.sourceId) ?? null });
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
    const errorText = retryErrors.map(error => `${error.name}: ${error.message}`).join("; ") || "AI ตอบไม่ครบ ยังไม่ได้ผลของโพสต์นี้";
    const delay = Math.max(0, ...retryErrors.map(error => "retryAfterMs" in error ? Number(error.retryAfterMs) || 0 : 0));
    for (const job of jobs) {
      const latencyMs = Date.now() - started;
      if (successIds.has(job.postId)) {
        await workerLog({ jobId: job.id, postId: job.postId, provider: outcome.providersById[job.postId], latencyMs, message: "จัดหมวดแล้ว" });
      } else await retry(job, errorText, delay, latencyMs);
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
