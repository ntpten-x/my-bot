import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { getSettings, upsertSettings } from "@/lib/settings";
import { replyQueueState } from "@/lib/reply-queue";
import { parseTimes } from "@/lib/reply-queue-core";
import { replyQueueSettingsSchema } from "@/lib/reply-queue-schema";

export const dynamic = "force-dynamic";

async function settingsView() {
  const s = await getSettings();
  return {
    enabled: s.replyQueueEnabled,
    times: s.replyQueueTimes.join(", "),
    dailyCap: s.replyDailyCap,
    gapMinMinutes: s.replyGapMinMinutes,
    gapMaxMinutes: s.replyGapMaxMinutes,
    authorDays: s.replyAuthorDays,
    groupDailyCap: s.replyGroupDailyCap,
    minScore: s.replyMinScore,
    autoAdvance: s.replyAutoAdvance,
    autoMarkSent: s.replyAutoMarkSent,
    autoInsert: s.replyAutoInsert,
  };
}

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  return json({ settings: await settingsView(), ...(await replyQueueState()) });
}

export async function PUT(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = replyQueueSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const data = parsed.data;
  const times = parseTimes(data.times);
  if (data.enabled && !times.length) return json({ error: "ใส่เวลาอย่างน้อย 1 เวลา เช่น 09:00" }, 400);
  await upsertSettings({
    reply_queue_enabled: String(data.enabled),
    reply_queue_times: times.join(","),
    reply_daily_cap: String(data.dailyCap),
    reply_gap_min_minutes: String(Math.min(data.gapMinMinutes, data.gapMaxMinutes)),
    reply_gap_max_minutes: String(Math.max(data.gapMinMinutes, data.gapMaxMinutes)),
    reply_author_days: String(data.authorDays),
    reply_group_daily_cap: String(data.groupDailyCap),
    reply_min_score: String(data.minScore),
    ...(data.autoAdvance === undefined ? {} : { reply_auto_advance: String(data.autoAdvance) }),
    ...(data.autoMarkSent === undefined ? {} : { reply_auto_mark_sent: String(data.autoMarkSent) }),
    ...(data.autoInsert === undefined ? {} : { reply_auto_insert: String(data.autoInsert) }),
  });
  return json({ settings: await settingsView() });
}
