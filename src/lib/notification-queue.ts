import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { dispatchNotification, shouldNotifyExternal } from "./notify";
import { workerLog } from "./log";

// Reuse Notification for a small local outbox. Internal rows are hidden from the UI.
export async function queueExternalNotification(postId: string, title: string) {
  const pending = await prisma.notification.findFirst({ where: { postId, channel: "external_pending" }, select: { id: true } });
  if (!pending) await prisma.notification.create({ data: { postId, title, channel: "external_pending", body: "0", read: true } });
}

export async function processNotificationQueue(limit = 10) {
  if (process.env.MYBOT_PROCESS !== "worker") return 0;
  const settings = await getSettings();
  const jobs = await prisma.notification.findMany({
    where: { channel: "external_pending", createdAt: { lte: new Date() } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit,
    include: { post: { include: { category: true, subcategory: true, source: true } } },
  });
  for (const job of jobs) {
    const post = job.post;
    if (!post || post.duplicateOfId || post.dismissed || post.score < settings.notifyMinScore || !shouldNotifyExternal(post)) {
      await prisma.notification.update({ where: { id: job.id }, data: { channel: "external_skipped", body: "" } });
      continue;
    }
    const sent = await prisma.notification.findMany({ where: { postId: post.id, channel: { in: ["line", "discord", "email"] } }, select: { channel: true } });
    const result = await dispatchNotification(post, settings, job.title, { external: true, skipInApp: true, skipChannels: sent.map(row => row.channel) });
    const failed = Object.values(result.channels).some(channel => !channel.ok && !channel.skipped);
    const attempts = (Number(job.body) || 0) + 1;
    await prisma.notification.update({ where: { id: job.id }, data: {
      channel: failed ? (attempts >= 5 ? "external_failed" : "external_pending") : "external_complete",
      body: failed ? String(attempts) : "",
      createdAt: new Date(Date.now() + Math.min(900_000, 30_000 * 2 ** attempts)),
    } });
    if (failed) await workerLog({ level: "error", postId: post.id, message: attempts >= 5 ? "พักการแจ้งเตือนภายนอกหลังส่งไม่สำเร็จ 5 ครั้ง" : "แจ้งเตือนบางช่องทางไม่สำเร็จ จะลองเฉพาะช่องทางที่ยังไม่ได้ส่ง" });
  }
  return jobs.length;
}
