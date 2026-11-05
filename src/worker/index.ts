import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { getSettings, upsertSettings } from "../lib/settings";
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
import { processNotificationQueue } from "../lib/notification-queue";
import { processFollowUps } from "../lib/automation";
import { maybeBuildScheduledReplyQueue } from "../lib/reply-queue";
import { acquireLease, releaseLease, pruneSentKeys, INSTANCE_ID, WORKER_LEASE, WORKER_LEASE_MS } from "../lib/lease";
import { runWatchdog } from "../lib/watchdog";

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
let consumerRunning = false;
let stopping = false;
let leader = false;
let leaderCheckedAt = 0;
let startupDone = false;

// Local and Render share the database: only the lease holder runs queues, alerts and schedules.
async function isLeader() {
  if (stopping) return false;
  if (Date.now() - leaderCheckedAt < 30_000) return leader;
  leaderCheckedAt = Date.now();
  const was = leader;
  try {
    leader = await acquireLease(WORKER_LEASE, WORKER_LEASE_MS);
  } catch (error) {
    // Can't reach the DB: stop leading until the lease is confirmed again.
    leader = false;
    console.error(`[worker] lease check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (leader !== was) console.log(leader ? `[worker] เป็นตัวหลัก (${INSTANCE_ID}) — รันคิวและงานตามเวลา` : `[worker] สแตนด์บาย — อีกเครื่องเป็นตัวหลักอยู่`);
  if (leader && !startupDone) { startupDone = true; await startupJobs(); }
  return leader;
}

async function startupJobs() {
  const queued = await enqueueUnclassifiedPosts().catch((error) => {
    const message = error instanceof Error ? error.message : "เข้าคิวไม่สำเร็จ";
    return workerLog({ level: "error", message: "เข้าคิวโพสต์ที่ยังเป็นกฎไม่สำเร็จ", error: message }).then(() => 0);
  });
  const linked = await collapseIdenticalTexts().catch(() => 0);
  const trimmed = await collapseTruncatedCaptures().catch(() => 0);
  const repaired = await repairStoredOverrides().catch(() => 0);
  await pruneSentKeys().catch(() => undefined);
  await workerLog({
    message: `เข้าคิวจัดหมวดโพสต์ที่ยังเป็นกฎ ${queued} รายการ ยุบข้อความซ้ำ ${linked} รายการ ยุบข้อความที่ถูกตัด ${trimmed} รายการ แก้หมวดด้วยกฎ ${repaired} รายการ`,
  }).catch(() => undefined);
}

// One consumer shares the local model; fetch/backup never hold up its next batch.
async function consume() {
  if (consumerRunning || stopping) return;
  consumerRunning = true;
  try {
    if (!(await isLeader())) return;
    for (;;) {
      if (stopping) break;
      const processed = await processAiQueue();
      const embedded = await backfillEmbeddings(5);
      const notified = await processNotificationQueue();
      if (!processed && !embedded.tried && !notified) break;
      if (!processed && !embedded.filled) break;
    }
  } catch (error) {
    await workerLog({ level: "error", message: "consumer ล้มเหลว จะตรวจใหม่ในรอบถัดไป", error: error instanceof Error ? error.message : String(error) });
  } finally { consumerRunning = false; }
}

async function tick() {
  if (running || stopping) return;
  running = true;
  try {
    if (!(await isLeader())) {
      await upsertSettings({ worker_standby_tick: new Date().toISOString() }).catch(() => undefined);
      return;
    }
    await upsertSettings({ worker_last_tick: new Date().toISOString(), worker_leader: INSTANCE_ID }).catch(() => undefined);
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
    await collapseTruncatedCaptures();
    await processFollowUps().catch((error) => workerLog({ level: "error", message: "เตือนตามลีดไม่สำเร็จ", error: String(error).slice(0, 300) }));
    await maybeBuildScheduledReplyQueue().catch((error) => workerLog({ level: "error", message: "สร้างคิวตอบลีดไม่สำเร็จ", error: String(error).slice(0, 300) }));
    await runWatchdog().catch((error) => workerLog({ level: "error", message: "ตัวเฝ้าระวังระบบล้มเหลว", error: String(error).slice(0, 300) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await workerLog({ level: "error", message: "รอบ worker ล้มเหลว", error: message.slice(0, 500) });
  } finally {
    running = false;
  }
}

console.log("[worker] MY-BOT worker เริ่มทำงาน — ตรวจ RSS และเว็บบอร์ดทุก 1 นาที");
void (async () => {
  await upsertSettings({ worker_started_at: new Date().toISOString() }).catch(() => undefined);
  const settings = await getSettings().catch(() => null);
  if (settings) await warmOllamaModels(settings).catch(() => undefined);
  const task = cron.schedule("* * * * *", () => { void tick(); }, { timezone: "Asia/Bangkok" });
  const timer = setInterval(() => { void consume(); }, 2000);
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ได้รับ ${signal} — ปิดอย่างปลอดภัย`);
    task.stop();
    clearInterval(timer);
    const deadline = Date.now() + 10_000;
    while ((running || consumerRunning) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
    await releaseLease(WORKER_LEASE).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGBREAK", () => void shutdown("SIGBREAK"));
  void tick();
  void consume();
})();
