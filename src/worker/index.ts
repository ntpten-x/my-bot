import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { getSettings } from "../lib/settings";
import { fetchRssPosts } from "../lib/rss";
import { fetchWebBoardPosts } from "../lib/web-board";
import { ingestPosts } from "../lib/ingest";
import { checkExtensionSilence } from "../lib/extension-status";
import { maybeSendScheduledSummary } from "../lib/smart/daily";
import { processAiQueue } from "../lib/ai/queue";
import { maybeBackupDatabase } from "../lib/backup";

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
        const message = error instanceof Error ? error.message : "ดึงข้อมูลไม่สำเร็จ";
        console.error(`[worker] ${source.name}: ${message}`);
        await prisma.source.update({
          where: { id: source.id },
          data: { lastError: message.slice(0, 500), lastFetchedAt: new Date() },
        });
        await prisma.fetchLog.create({
          data: { sourceId: source.id, status: "error", message: message.slice(0, 500), postsFound: 0 },
        });
      }
    }
    await checkExtensionSilence();
    await maybeSendScheduledSummary();
    await maybeBackupDatabase();
    await processAiQueue();
  } catch (error) {
    console.error("[worker]", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

cron.schedule("* * * * *", () => {
  void tick();
}, { timezone: "Asia/Bangkok" });

console.log("[worker] MY-BOT worker เริ่มทำงาน — ตรวจ RSS และเว็บบอร์ดทุก 1 นาที");
void tick();
