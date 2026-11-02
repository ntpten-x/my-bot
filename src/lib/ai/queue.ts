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

export async function processAiQueue() {
  if (process.env.MYBOT_PROCESS !== "worker" || running) return 0;
  running = true;
  let claimed: { id: string; postId: string; attempts: number }[] = [];
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const retry = async (job: typeof claimed[number], message: string, delay = 0, latencyMs?: number) => {
    const attempts = job.attempts + 1;
    const status = attempts >= MAX_AI_ATTEMPTS ? "failed" : "pending";
    await prisma.aiJob.updateMany({
      where: { id: job.id, status: "running" },
      data: { status, attempts, nextAttemptAt: new Date(Date.now() + Math.max(delay, backoffMs(job.attempts))), lastError: message.slice(0, 500), latencyMs },
    });
    await workerLog({ level: "error", jobId: job.id, postId: job.postId, message: status === "failed" ? "พักงาน AI หลังผิดซ้ำ กดลองใหม่ได้ที่แดชบอร์ด" : "คืนงาน AI เพื่อรอลองใหม่", error: message.slice(0, 500), latencyMs });
  };
  try {
    const settings = await getSettings();
    await prisma.aiJob.updateMany({
      where: { status: "running", updatedAt: { lt: new Date(Date.now() - STUCK_JOB_MS) } },
      data: { status: "pending", nextAttemptAt: new Date(), lastError: "worker หยุดตอบเกิน 2 นาที จึงคืนเข้าคิว" },
    });
    if (settings.aiProvider !== "rules") {
      await prisma.aiJob.updateMany({ where: { status: "skipped" }, data: { status: "pending", nextAttemptAt: new Date() } });
    }
    const jobs = await prisma.$transaction(async tx => {
      const rows = await tx.aiJob.findMany({
        where: { status: "pending", nextAttemptAt: { lte: new Date() } },
        orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], take: 10, include: { post: true },
      });
      if (rows.length) await tx.aiJob.updateMany({ where: { id: { in: rows.map(row => row.id) }, status: "pending" }, data: { status: "running" } });
      return rows;
    });
    if (!jobs.length) return 0;
    claimed = jobs;
    const started = Date.now();
    for (const job of jobs) {
      await prisma.aiJob.update({ where: { id: job.id }, data: { queueWaitMs: Math.min(2_147_483_647, Math.max(0, started - job.createdAt.getTime())) } });
    }
    heartbeat = setInterval(() => {
      void prisma.aiJob.updateMany({ where: { id: { in: claimed.map(job => job.id) }, status: "running" }, data: { updatedAt: new Date() } }).catch(() => undefined);
    }, 30_000);
    heartbeat.unref();
    if (settings.aiProvider === "rules") {
      await prisma.aiJob.updateMany({ where: { id: { in: jobs.map(job => job.id) } }, data: { status: "skipped", lastError: "เจ้าของเลือกใช้กฎ ไม่เรียก AI" } });
      claimed = [];
      return jobs.length;
    }
    const { rows, catalog } = await loadCatalogFromDb();
    const inputs = [];
    for (const job of jobs) {
      let ocrText = job.post.ocrText;
      if (settings.ocrEnabled && !ocrText) {
        try {
          const parsed: unknown = JSON.parse(job.post.imagesJson);
          ocrText = await ocrPostImages(Array.isArray(parsed) ? parsed.map(String) : [], settings);
          if (ocrText) await prisma.post.update({ where: { id: job.postId }, data: { ocrText } });
        } catch {
          await workerLog({ level: "error", jobId: job.id, postId: job.postId, message: "OCR ล้มเหลว จะจัดหมวดต่อโดยไม่มีข้อความจากรูป" });
        }
      }
      inputs.push({ id: job.postId, text: ocrText ? `${job.post.text}\n${ocrText}` : job.post.text, contentHash: ocrText ? `${job.post.contentHash}:ocr` : job.post.contentHash });
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
    const successful = outcome.results.filter(item => outcome.providersById[item.id] && outcome.providersById[item.id] !== "rules");
    for (const item of successful) {
      const ids = resolveCategoryIds(rows, item.categorySlug, item.subcategorySlug);
      await prisma.post.update({ where: { id: item.id }, data: { categoryId: ids.categoryId, subcategoryId: ids.subcategoryId, intent: item.intent, province: item.province, isAd: item.isAd, suggestedReply: item.suggestedReply, aiProvider: outcome.providersById[item.id] } });
    }
    // Scoring must not block completion on an embedding provider.
    await enrichPosts(successful.map(item => item.id), successful, settings, { embed: false });
    const successIds = new Set(successful.map(item => item.id));
    const retryErrors = outcome.errors.filter(error => !error.message.startsWith("ข้าม "));
    const errorText = retryErrors.map(error => `${error.name}: ${error.message}`).join("; ") || "AI ตอบไม่ครบ ยังไม่ได้ผลของโพสต์นี้";
    const delay = Math.max(0, ...retryErrors.map(error => "retryAfterMs" in error ? Number(error.retryAfterMs) || 0 : 0));
    for (const job of jobs) {
      const latencyMs = Date.now() - started;
      if (successIds.has(job.postId)) {
        await prisma.aiJob.update({ where: { id: job.id }, data: { status: "done", lastError: "", latencyMs } });
        await workerLog({ jobId: job.id, postId: job.postId, provider: outcome.providersById[job.postId], latencyMs, message: "จัดหมวดแล้ว" });
      } else await retry(job, errorText, delay, latencyMs);
    }
    claimed = [];
    const ready = await prisma.post.findMany({ where: { id: { in: [...successIds] }, duplicateOfId: null }, include: { category: true, subcategory: true, source: true } });
    for (const post of ready) {
      if (post.score < 80 || !shouldNotifyExternal(post)) continue;
      const already = await prisma.notification.count({ where: { postId: post.id, channel: { in: ["discord", "line", "email"] } } });
      if (!already) await queueExternalNotification(post.id, "ลีดร้อน");
    }
    return jobs.length;
  } catch (error) {
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
