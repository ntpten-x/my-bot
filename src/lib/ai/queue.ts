import { prisma } from "../prisma";
import { getSettings } from "../settings";
import { loadCatalogFromDb, resolveCategoryIds } from "../sources";
import { classifyLeads } from "./run";
import { ProviderHttpError, backoffMs } from "./bucket";
import { ocrPostImages } from "../ocr";
import { enrichPosts } from "../smart/enrich";
import { dispatchNotification, shouldNotifyExternal } from "../notify";
import { workerLog } from "../log";

export const STUCK_JOB_MS = 2 * 60 * 1000;

let running = false;

export async function enqueueAiJobs(postIds: string[]) {
  if (!postIds.length) return;
  for (const postId of postIds) {
    await prisma.aiJob.upsert({
      where: { postId },
      update: { status: "pending", nextAttemptAt: new Date(), lastError: "" },
      create: { postId, status: "pending", nextAttemptAt: new Date() },
    });
  }
}

export async function enqueueUnclassifiedPosts() {
  const posts = await prisma.post.findMany({
    where: { OR: [{ aiProvider: null }, { aiProvider: "rules" }] },
    select: { id: true },
  });
  const ids = posts.map((post) => post.id);
  for (let index = 0; index < ids.length; index += 50) {
    await enqueueAiJobs(ids.slice(index, index + 50));
  }
  return ids.length;
}

async function releaseJobs(ids: string[], error: unknown, attempts: number) {
  if (!ids.length) return;
  const retryAfter = error instanceof ProviderHttpError ? error.retryAfterMs : 0;
  const delay = retryAfter || backoffMs(attempts + 1);
  const message = error instanceof Error ? error.message : "จัดหมวดไม่สำเร็จ";
  await prisma.aiJob.updateMany({
    where: { id: { in: ids }, status: "running" },
    data: {
      status: "pending",
      attempts: { increment: 1 },
      nextAttemptAt: new Date(Date.now() + delay),
      lastError: message.slice(0, 500),
    },
  });
  await workerLog({
    level: "error",
    jobId: ids[0],
    provider: "rules",
    message: "คิวจัดหมวดคืนเป็น pending",
    error: message.slice(0, 500),
  });
}

export async function processAiQueue() {
  if (process.env.MYBOT_PROCESS !== "worker") return;
  if (running) return;
  running = true;
  const claimed: string[] = [];
  try {
    await prisma.aiJob.updateMany({
      where: { status: "running", updatedAt: { lt: new Date(Date.now() - STUCK_JOB_MS) } },
      data: { status: "pending", lastError: "ค้างเกิน 2 นาที จึงคืนเข้าคิว" },
    });
    const jobs = await prisma.aiJob.findMany({
      where: { status: "pending", nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: "asc" },
      take: 10,
      include: { post: true },
    });
    if (!jobs.length) return;
    claimed.push(...jobs.map((job) => job.id));
    await prisma.aiJob.updateMany({
      where: { id: { in: claimed } },
      data: { status: "running" },
    });
    const started = new Map(jobs.map((job) => [job.id, Date.now()]));
    const settings = await getSettings();
    const { rows, catalog } = await loadCatalogFromDb();
    const inputs = [];
    for (const job of jobs) {
      let text = job.post.text;
      let ocrText = job.post.ocrText;
      if (settings.ocrEnabled && !ocrText) {
        let images: string[] = [];
        try {
          const parsed = JSON.parse(job.post.imagesJson);
          if (Array.isArray(parsed)) images = parsed.map(String);
        } catch {
          images = [];
        }
        try {
          ocrText = await ocrPostImages(images, settings);
          if (ocrText) await prisma.post.update({ where: { id: job.postId }, data: { ocrText } });
        } catch (error) {
          const message = error instanceof Error ? error.message : "อ่านข้อความในรูปไม่สำเร็จ";
          await workerLog({
            level: "error",
            jobId: job.id,
            postId: job.postId,
            message: "OCR ล้มเหลว จะจัดหมวดต่อโดยไม่มีข้อความจากรูป",
            error: message.slice(0, 500),
          });
          ocrText = "";
        }
      }
      if (ocrText) text = `${text}\n${ocrText}`;
      inputs.push({
        id: job.postId,
        text,
        contentHash: ocrText ? `${job.post.contentHash}:ocr` : job.post.contentHash,
      });
    }
    const outcome = await classifyLeads(inputs, catalog, settings, {
      async get(key) {
        const row = await prisma.aiCache.findUnique({ where: { cacheKey: key } });
        if (!row || row.provider === "rules") return null;
        return { provider: row.provider, item: JSON.parse(row.result) };
      },
      async set(key, hit) {
        await prisma.aiCache.upsert({
          where: { cacheKey: key },
          update: { provider: hit.provider, result: JSON.stringify(hit.item) },
          create: { cacheKey: key, provider: hit.provider, result: JSON.stringify(hit.item) },
        });
      },
    });
    const latencyOf = (id: string) => Date.now() - (started.get(id) ?? Date.now());
    if (outcome.provider !== "rules") {
      for (const item of outcome.results) {
        const ids = resolveCategoryIds(rows, item.categorySlug, item.subcategorySlug);
        await prisma.post.update({
          where: { id: item.id },
          data: {
            categoryId: ids.categoryId,
            subcategoryId: ids.subcategoryId,
            intent: item.intent,
            province: item.province,
            isAd: item.isAd,
            suggestedReply: item.suggestedReply,
            aiProvider: outcome.provider,
          },
        });
      }
      await enrichPosts(jobs.map((job) => job.postId), outcome.results, settings);
      for (const job of jobs) {
        const latencyMs = latencyOf(job.id);
        await prisma.aiJob.update({
          where: { id: job.id },
          data: { status: "done", lastError: "", latencyMs },
        });
        await workerLog({
          jobId: job.id,
          postId: job.postId,
          provider: outcome.provider,
          latencyMs,
          message: "จัดหมวดแล้ว",
        });
      }
      claimed.length = 0;
      const ready = await prisma.post.findMany({
        where: { id: { in: jobs.map((job) => job.postId) } },
        include: { category: true, subcategory: true, source: true },
      });
      for (const post of ready) {
        if (post.score < 80) continue;
        const already = await prisma.notification.count({ where: { postId: post.id, channel: "discord" } });
        if (already || !shouldNotifyExternal(post)) continue;
        await dispatchNotification(post, settings, "ลีดร้อน", { external: true });
      }
    } else {
      const retry = outcome.errors[0]?.message ?? "ยังไม่มี AI";
      const delay = backoffMs(jobs[0]?.attempts ?? 0);
      for (const job of jobs) {
        const latencyMs = latencyOf(job.id);
        await prisma.aiJob.update({
          where: { id: job.id },
          data: {
            status: "pending",
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + delay),
            lastError: retry.slice(0, 500),
            latencyMs,
          },
        });
        await workerLog({
          level: "error",
          jobId: job.id,
          postId: job.postId,
          provider: "rules",
          latencyMs,
          message: "ยังจัดด้วยกฎ จะลอง AI ใหม่",
          error: retry.slice(0, 500),
        });
      }
      claimed.length = 0;
    }
  } catch (error) {
    try {
      await releaseJobs(claimed, error, 1);
    } catch (releaseError) {
      const message = releaseError instanceof Error ? releaseError.message : "คืนคิวไม่สำเร็จ";
      await workerLog({ level: "error", message, error: message });
    }
    claimed.length = 0;
  } finally {
    running = false;
  }
}
