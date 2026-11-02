import { prisma } from "../prisma";
import { getSettings } from "../settings";
import { upsertSettings } from "../settings";
import { dispatchNotification } from "../notify";
import { bangkokStart } from "../format";
import { buildSummary, bangkokClock, shouldSendSummary } from "./summary";

export async function composeDailySummary(dayLabel: string, from: Date, to: Date) {
  const posts = await prisma.post.findMany({
    where: { createdAt: { gte: from, lt: to }, dismissed: false },
    include: { category: true, source: true },
    orderBy: { score: "desc" },
  });
  const summary = buildSummary(
    dayLabel,
    posts.map((post) => ({
      text: post.text,
      score: post.score,
      url: post.externalUrl,
      category: post.category?.name ?? "อื่นๆ",
      keywords: (() => {
        try {
          const parsed = JSON.parse(post.keywordHitsJson);
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      })(),
      sourceName: post.source.name,
      intent: post.intent,
      isAd: post.isAd,
    })),
  );
  const saved = await prisma.summary.upsert({
    where: { day: dayLabel },
    update: { title: summary.title, body: summary.body },
    create: { day: dayLabel, title: summary.title, body: summary.body },
  });
  const settings = await getSettings();
  await dispatchNotification(
    {
      id: null,
      text: summary.body,
      externalUrl: "http://localhost:8001/summaries",
      intent: "unknown",
      province: null,
      category: { name: "สรุปรายวัน" },
      source: { name: "MY-BOT" },
    },
    settings,
    summary.title,
    { external: true, forceExternal: true, discordMode: "embed" },
  );
  return saved;
}

export async function sendDailySummaryNow() {
  const start = bangkokStart(1);
  const end = bangkokStart(0);
  const clock = bangkokClock(start);
  return composeDailySummary(clock.day, start, end);
}

export async function maybeSendScheduledSummary() {
  const settings = await getSettings();
  const clock = bangkokClock();
  const last = await prisma.setting.findUnique({ where: { key: "summary_last_day" } });
  if (!shouldSendSummary(clock.time, settings.summaryTime, last?.value ?? null, clock.day)) return;
  const start = bangkokStart(1);
  const end = bangkokStart(0);
  await composeDailySummary(bangkokClock(start).day, start, end);
  await upsertSettings({ summary_last_day: clock.day });
}
