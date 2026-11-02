import { prisma } from "../prisma";
import { getSettings } from "../settings";
import { loadCatalogFromDb, resolveCategoryIds } from "../sources";
import { classifyLeads } from "./run";
import { ProviderHttpError } from "./bucket";
import { backoffMs } from "./bucket";
import { ocrPostImages } from "../ocr";
import { enrichPosts } from "../smart/enrich";
import { dispatchNotification, shouldNotifyExternal } from "../notify";

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

export async function processAiQueue() {
  if (running) return;
  running = true;
  try {
    await prisma.aiJob.updateMany({
      where: { status: "running", updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
      data: { status: "pending" },
    });
    const jobs = await prisma.aiJob.findMany({
      where: { status: "pending", nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: "asc" },
      take: 10,
      include: { post: true },
    });
    if (!jobs.length) return;
    await prisma.aiJob.updateMany({
      where: { id: { in: jobs.map((job) => job.id) } },
      data: { status: "running" },
    });
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
        ocrText = await ocrPostImages(images, settings);
        if (ocrText) await prisma.post.update({ where: { id: job.postId }, data: { ocrText } });
      }
      if (ocrText) text = `${text}\n${ocrText}`;
      inputs.push({
        id: job.postId,
        text,
        contentHash: ocrText ? `${job.post.contentHash}:ocr` : job.post.contentHash,
      });
    }
    try {
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
      const upgraded = outcome.provider !== "rules";
      if (upgraded) {
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
        await prisma.aiJob.updateMany({
          where: { id: { in: jobs.map((job) => job.id) } },
          data: { status: "done", lastError: "" },
        });
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
        await prisma.aiJob.updateMany({
          where: { id: { in: jobs.map((job) => job.id) } },
          data: {
            status: "pending",
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + delay),
            lastError: retry.slice(0, 500),
          },
        });
      }
    } catch (error) {
      const retryAfter = error instanceof ProviderHttpError ? error.retryAfterMs : 0;
      const delay = retryAfter || backoffMs((jobs[0]?.attempts ?? 0) + 1);
      const message = error instanceof Error ? error.message : "จัดหมวดไม่สำเร็จ";
      await prisma.aiJob.updateMany({
        where: { id: { in: jobs.map((job) => job.id) } },
        data: {
          status: "pending",
          attempts: { increment: 1 },
          nextAttemptAt: new Date(Date.now() + delay),
          lastError: message.slice(0, 500),
        },
      });
    }
  } finally {
    running = false;
  }
}
