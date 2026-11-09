import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";

export const POST_PROCESSING_LEASE_MS = 120_000;
export const POST_PROCESSING_RETRY_MS = 30_000;
export type PostRevision = { id: string; textRevision: number };
export const pendingPostWork = (now = new Date()) => ({
  processingState: { in: ["pending_new", "pending_edit"] }, processingRetryAt: { lte: now },
});

/** Durable Post rows are the work queue. CAS claims also fence late callbacks and edits. */
export async function runPostProcessing(
  revisions: PostRevision[],
  run: (rows: (PostRevision & { sourceId: string; processingState: string })[], guard: () => Promise<void>) => Promise<string[] | void>,
  assertActive: () => Promise<void> = async () => undefined,
) {
  if (!revisions.length) return 0;
  await assertActive();
  const token = randomUUID();
  await prisma.post.updateMany({
    where: { ...pendingPostWork(), OR: revisions },
    data: { processingToken: token, processingRetryAt: new Date(Date.now() + POST_PROCESSING_LEASE_MS) },
  });
  const rows = await prisma.post.findMany({ where: { processingToken: token }, select: { id: true, textRevision: true, sourceId: true, processingState: true } });
  if (!rows.length) return 0;
  let lost = false;
  let renewing: Promise<void> | null = null;
  const guard = async () => {
    await assertActive();
    if (lost || await prisma.post.count({ where: { processingToken: token, processingRetryAt: { gt: new Date() } } }) !== rows.length) {
      throw new Error("Post processing claim changed");
    }
  };
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = (async () => {
      await assertActive();
      const result = await prisma.post.updateMany({
        where: { processingToken: token, processingRetryAt: { gt: new Date() } },
        data: { processingRetryAt: new Date(Date.now() + POST_PROCESSING_LEASE_MS) },
      });
      if (result.count !== rows.length) lost = true;
    })().catch(() => { lost = true; }).finally(() => { renewing = null; });
  }, 20_000);
  timer.unref();
  try {
    await guard();
    const completedIds = await run(rows, guard);
    await guard();
    const completed = await prisma.post.updateMany({ where: { processingToken: token, ...(completedIds ? { id: { in: completedIds } } : {}) }, data: { processingState: "done", processingToken: null, processingError: "" } });
    // A cooperative yield releases unfinished rows without acknowledging them.
    await prisma.post.updateMany({ where: { processingToken: token }, data: { processingToken: null, processingRetryAt: new Date() } });
    return completed.count;
  } catch (error) {
    await prisma.post.updateMany({ where: { processingToken: token }, data: {
      processingToken: null, processingRetryAt: new Date(Date.now() + POST_PROCESSING_RETRY_MS),
      processingError: "ประมวลผลกฎยังไม่ครบ จะลองใหม่โดยอัตโนมัติ",
    } }).catch(() => undefined);
    throw error;
  } finally {
    clearInterval(timer);
    if (renewing) await renewing;
  }
}
