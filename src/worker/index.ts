import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { getSettings } from "../lib/settings";
import { fetchRssPosts } from "../lib/rss";
import { fetchWebBoardPosts } from "../lib/web-board";
import { ingestPosts } from "../lib/ingest";
import { checkExtensionSilence } from "../lib/extension-status";
import { maybeSendScheduledSummary } from "../lib/smart/daily";
import { enqueueUnclassifiedPosts, processAiQueue } from "../lib/ai/queue";
import { maybeBackupDatabase } from "../lib/backup";
import { backfillEmbeddings } from "../lib/smart/backfill";
import { collapseIdenticalTexts, collapseTruncatedCaptures } from "../lib/smart/enrich";
import { repairStoredOverrides } from "../lib/pipeline/repair";
import { warmOllamaModels } from "../lib/ai/warm";
import { fetchErrorReason } from "../lib/fetch-error";
import { workerLog } from "../lib/log";

process.env.MYBOT_PROCESS = "worker";

process.on("uncaughtException", (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  void workerLog({ level: "error", message: "uncaughtException", error: message.slice(0, 800) });
});
process.on("unhandledRejection", (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  void workerLog({ level: "error", message: "unhandledRejection", error: message.slice(0, 800) });
});

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const settings = await getSettings();
    const sources = await prisma.source.findMany({
      where: { enabled: true, type: { in: ["rss", "web_board"] } },
    });
    const now = Date.now();
    for (const source of sources) {
      const minutes = source.intervalMinutes || settings.fetchIntervalMinutes;
      const last = source.lastFetchedAt?.getTime() ?? 0;
      if (now - last < minutes * 60 * 1000) continue;
      try {
        const posts = source.type === "rss" ? await fetchRssPosts(source.url) : await fetchWebBoardPosts(source.url);
        const result = await ingestPosts({ sourceUrl: source.url, posts, actor: "worker" });
        console.log(`[worker] ${source.name}: ใหม่ ${result.inserted} ซ้ำ ${result.duplicates}`);
      } catch (error) {
        const message = fetchErrorReason(error, source.type === "rss" ? "RSS" : "เว็บบอร์ด").slice(0, 500);
        await workerLog({ level: "error", message: `${source.name} ดึงไม่สำเร็จ`, error: message });
        await prisma.source.update({
          where: { id: source.id },
          data: { lastError: message, lastFetchedAt: new Date() },
        });
        await prisma.fetchLog.create({
          data: { sourceId: source.id, status: "error", message, postsFound: 0 },
        });
      }
    }
    await checkExtensionSilence();
    await maybeSendScheduledSummary();
    await maybeBackupDatabase();
    await processAiQueue();
    await backfillEmbeddings(5);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await workerLog({ level: "error", message: "รอบ worker ล้มเหลว", error: message.slice(0, 500) });
  } finally {
    running = false;
  }
}

cron.schedule("* * * * *", () => {
  void tick();
}, { timezone: "Asia/Bangkok" });

console.log("[worker] MY-BOT worker เริ่มทำงาน — ตรวจ RSS และเว็บบอร์ดทุก 1 นาที");
void (async () => {
  const queued = await enqueueUnclassifiedPosts().catch((error) => {
    const message = error instanceof Error ? error.message : "เข้าคิวไม่สำเร็จ";
    return workerLog({ level: "error", message: "เข้าคิวโพสต์ที่ยังเป็นกฎไม่สำเร็จ", error: message }).then(() => 0);
  });
  const linked = await collapseIdenticalTexts().catch(() => 0);
  const trimmed = await collapseTruncatedCaptures().catch(() => 0);
  const repaired = await repairStoredOverrides().catch(() => 0);
  await workerLog({
    message: `เข้าคิวจัดหมวดโพสต์ที่ยังเป็นกฎ ${queued} รายการ ยุบข้อความซ้ำ ${linked} รายการ ยุบข้อความที่ถูกตัด ${trimmed} รายการ แก้หมวดด้วยกฎ ${repaired} รายการ`,
  });
  const settings = await getSettings();
  await warmOllamaModels(settings);
  await tick();
})();
