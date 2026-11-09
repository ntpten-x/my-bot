import cron from "node-cron";
import { WorkerLease } from "../lib/worker-lease";
import { prisma } from "../lib/prisma";
import { getSettings, upsertSettings } from "../lib/settings";
import { fetchRssPosts } from "../lib/rss";
import { fetchWebBoardPosts } from "../lib/web-board";
import { ingestPosts, processPendingIngest } from "../lib/ingest";
import { maybeSendScheduledSummary } from "../lib/smart/daily";
import { maybeBackupDatabase } from "../lib/backup";
import { collapseIdenticalTexts, collapseTruncatedCaptures } from "../lib/smart/enrich";
import { repairStoredOverrides } from "../lib/pipeline/repair";
import { fetchErrorReason } from "../lib/fetch-error";
import { workerLog } from "../lib/log";
import { processNotificationQueue } from "../lib/notification-queue";
import { processFollowUps } from "../lib/automation";
import { maybeBuildScheduledReplyQueue } from "../lib/reply-queue";
import { acquireLease, releaseLease, pruneSentKeys, INSTANCE_ID, WORKER_LEASE, WORKER_LEASE_MS } from "../lib/lease";
import { runWatchdog } from "../lib/watchdog";
import { maybeRunRetention } from "../lib/retention";
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
let postRunning = false;
let commentRunning = false;
let stopping = false;
let startupPromise: Promise<void> | null = null;
let consumerProgressAt = 0;
let postProgressAt = 0;
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
  if (!startupPromise) startupPromise = startupJobs().catch(error => { startupPromise = null; throw error; });
  await startupPromise;
  return lease.active();
}

async function startupJobs() {
  const linked = await collapseIdenticalTexts().catch(() => 0);
  const trimmed = await collapseTruncatedCaptures().catch(() => 0);
  const repaired = await repairStoredOverrides().catch(() => 0);
  await pruneSentKeys().catch(() => undefined);
  await workerLog({
    message: `บอทใช้กฎ ยุบข้อความซ้ำ ${linked} รายการ ยุบข้อความที่ถูกตัด ${trimmed} รายการ แก้หมวดด้วยกฎ ${repaired} รายการ`,
  }).catch(() => undefined);
}

// Notifications have an independent consumer; capture and comments never wait on a model.
async function consume() {
  if (consumerRunning || stopping) return;
  consumerRunning = true;
  try {
    if (!(await isLeader())) return;
    for (;;) {
      if (stopping || !lease.active()) break;
      if (Date.now() - consumerProgressAt > 30_000) { await upsertSettings({ worker_consumer_progress: new Date().toISOString() }); consumerProgressAt = Date.now(); }
      await assertActive();
      const notified = await processNotificationQueue(10, assertActive);
      if (!notified) break;
    }
  } catch (error) {
    await workerLog({ level: "error", message: "consumer ล้มเหลว จะตรวจใหม่ในรอบถัดไป", error: error instanceof Error ? error.message : String(error) });
  } finally { consumerRunning = false; }
}

async function consumePosts() {
  if (postRunning || stopping) return;
  postRunning = true;
  try {
    if (!await isLeader()) return;
    await processPendingIngest(40, assertActive);
    if (Date.now() - postProgressAt > 30_000) {
      await upsertSettings({ worker_post_progress: new Date().toISOString() });
      postProgressAt = Date.now();
    }
  } catch (error) {
    await workerLog({ level: "error", message: "งานประมวลผลโพสต์ยังไม่ครบ จะรับต่อจากฐานข้อมูล", error: String(error).slice(0, 300) });
  } finally { postRunning = false; }
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
  const task = cron.schedule("* * * * *", () => { void tick(); }, { timezone: "Asia/Bangkok" });
  const timer = setInterval(() => { void consume(); }, 2000);
  const postTimer = setInterval(() => { void consumePosts(); }, 2000);
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
    clearInterval(postTimer);
    clearInterval(commentTimer);
    lease.stop();
    const deadline = Date.now() + 10_000;
    while ((running || consumerRunning || postRunning || commentRunning) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
    await releaseLease(WORKER_LEASE).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGBREAK", () => void shutdown("SIGBREAK"));
  void tick();
  void consume();
  void consumePosts();
})();
