import cron from "node-cron";
import { WorkerLease } from "../lib/worker-lease";
import { prisma } from "../lib/prisma";
import { getSettings, upsertSettings } from "../lib/settings";
import { fetchRssPosts } from "../lib/rss";
import { fetchWebBoardPosts } from "../lib/web-board";
import { ingestPosts } from "../lib/ingest";
import { maybeSendScheduledSummary } from "../lib/smart/daily";
import { enqueueUnclassifiedPosts, processAiQueue, repairMissingAiJobs } from "../lib/ai/queue";
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
import { maybeRunRetention } from "../lib/retention";
import { maybeReclassify } from "../lib/reclassify";
import { backfillProducts } from "../lib/products";
import { assertProductionConfig } from "../lib/production-config";
import { autoCommentTick } from "../lib/auto-comment/poll";

process.env.MYBOT_PROCESS = "worker";
assertProductionConfig();

let fatal = false;
function fatalWorker(error: unknown) {
  if (fatal) return; fatal = true;
  const timer = setTimeout(() => process.exit(1), 1000); timer.unref();
  void workerLog({ level: "error", message: "fatal worker error; restarting", error: error instanceof Error ? error.message : "unhandled error" }).finally(() => process.exit(1));
}
process.on("uncaughtException", fatalWorker);
process.on("unhandledRejection", fatalWorker);

let running = false;
let consumerRunning = false;
let commentRunning = false;
let stopping = false;
let startupDone = false;
let consumerProgressAt = 0;
const lease = new WorkerLease({
  acquire: () => acquireLease(WORKER_LEASE, WORKER_LEASE_MS),
  ttlMs: WORKER_LEASE_MS,
  onLost: () => {
    // Never release another holder's lease or keep running jobs after losing ours.
    // The supervisor restarts us; claimed AI jobs recover via their stale timeout.
    console.error("[worker] ยืนยัน lease ไม่ได้ — หยุดทันทีเพื่อป้องกันงานซ้ำ");
    process.exit(1);
  },
});
const assertActive = () => lease.assertActive();
async function isLeader() {
  if (stopping) return false;
  if (!lease.active() && !(await lease.renew())) return false;
  if (!startupDone) {
    startupDone = true;
    console.log(`[worker] เป็นตัวหลัก (${INSTANCE_ID})`);
    await startupJobs();
  }
  return lease.active();
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
      if (stopping || !lease.active()) break;
      const processed = await processAiQueue(assertActive);
      if (Date.now() - consumerProgressAt > 30_000) { await upsertSettings({ worker_consumer_progress: new Date().toISOString() }); consumerProgressAt = Date.now(); }
      await assertActive();
      const settings = await getSettings();
      const embedded = settings.aiProvider === "rules"
        ? { tried: false, filled: 0 }
        : await backfillEmbeddings(5);
      await assertActive();
      const notified = await processNotificationQueue(10, assertActive);
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
    await repairMissingAiJobs();
    const settings = await getSettings();
    const sources = await prisma.source.findMany({
      where: { enabled: true, type: { in: ["rss", "web_board"] } },
    });
    const now = Date.now();
    for (const source of sources) {
      await assertActive();
      const minutes = source.intervalMinutes || settings.fetchIntervalMinutes;
      const last = source.lastFetchedAt?.getTime() ?? 0;
      if (now - last < minutes * 60 * 1000) continue;
      try {
        const posts = source.type === "rss" ? await fetchRssPosts(source.url) : await fetchWebBoardPosts(source.url);
        await assertActive();
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
    await assertActive();
    await maybeSendScheduledSummary();
    await assertActive();
    await maybeBackupDatabase();
    await assertActive();
    await maybeRunRetention().catch(() => undefined);
    await assertActive();
    await backfillProducts().catch(() => undefined);
    await assertActive();
    await maybeReclassify().catch(() => undefined);
    await assertActive();
    await collapseTruncatedCaptures();
    await assertActive();
    await processFollowUps().catch((error) => workerLog({ level: "error", message: "เตือนตามลีดไม่สำเร็จ", error: String(error).slice(0, 300) }));
    await assertActive();
    await maybeBuildScheduledReplyQueue().catch((error) => workerLog({ level: "error", message: "สร้างคิวตอบลีดไม่สำเร็จ", error: String(error).slice(0, 300) }));
    await assertActive();
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
  lease.start();
  await upsertSettings({ worker_started_at: new Date().toISOString() }).catch(() => undefined);
  // One-shot: feed/classify runs on keyword rules by default so the bot does not wait on cloud/local LLM.
  // Owner can still switch back to auto/ollama/gemini/groq in Settings afterward.
  const prior = await prisma.setting.findUnique({ where: { key: "bot_rules_only_v1" } }).catch(() => null);
  if (!prior) {
    await upsertSettings({ ai_provider: "rules", bot_rules_only_v1: "1" }).catch(() => undefined);
    await workerLog({ level: "info", message: "ปิด AI จัดหมวด — ใช้คำจับคู่เป็นค่าเริ่มต้น (ตั้งค่าใหม่ได้ที่หน้าตั้งค่า)" }).catch(() => undefined);
  }
  const settings = await getSettings().catch(() => null);
  if (settings && settings.aiProvider !== "rules") await warmOllamaModels(settings).catch(() => undefined);
  const task = cron.schedule("* * * * *", () => { void tick(); }, { timezone: "Asia/Bangkok" });
  const timer = setInterval(() => { void consume(); }, 2000);
  const commentTimer = setInterval(() => {
    void (async () => {
      if (commentRunning || stopping) return;
      commentRunning = true;
      try { if (await isLeader()) await autoCommentTick(assertActive); }
      finally { commentRunning = false; }
    })()
      .catch(() => workerLog({ level: "error", message: "Auto Comment ตรวจงานไม่สำเร็จ จะลองในรอบถัดไป" }));
  }, 3000);
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ได้รับ ${signal} — ปิดอย่างปลอดภัย`);
    task.stop();
    clearInterval(timer);
    clearInterval(commentTimer);
    lease.stop();
    const deadline = Date.now() + 10_000;
    while ((running || consumerRunning || commentRunning) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
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
