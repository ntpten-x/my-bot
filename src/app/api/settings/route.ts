import { getSession } from "@/lib/auth";
import { allowedDiscordWebhook } from "@/lib/discord";
import { readJson } from "@/lib/request-body";
import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { getSettings, publicSettings, upsertSettings } from "@/lib/settings";
import { commentMutationGuard } from "@/lib/auto-comment/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  return json({ settings: publicSettings(await getSettings()) });
}

const putSchema = z.object({
  fetchIntervalMinutes: z.number().int().min(5).max(180).optional(),
  jitterMinutes: z.number().int().min(0).max(30).optional(),
  maxGroupsPerCycle: z.number().int().min(1).max(20).optional(),
  scrollScreens: z.number().int().min(0).max(10).optional(),
  maxPostAgeHours: z.number().int().min(1).max(24).optional(),
  maxPostsPerRun: z.number().int().min(5).max(200).optional(),
  lineUserId: z.string().optional(),
  updateLineToken: z.boolean().optional(),
  lineToken: z.string().optional(),
  discordWebhook: z.string().max(2048).refine(value => !value.trim() || allowedDiscordWebhook(value.trim())).optional(),
  updateDiscordWebhook: z.boolean().optional(),
  notifyEmailTo: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().optional(),
  updateSmtpPass: z.boolean().optional(),
  smtpPass: z.string().optional(),
  notifySound: z.boolean().optional(),
  notifyMinScore: z.number().int().min(0).max(100).optional(),
  watchEnabled: z.boolean().optional(),
  watchNoPostsHours: z.number().int().min(1).max(48).optional(),
  watchExtOfflineMinutes: z.number().int().min(5).max(720).optional(),
  watchAlertEveryHours: z.number().int().min(1).max(48).optional(),
  postRetentionDays: z.number().int().min(3).max(365).optional(),
  leadRetentionDays: z.number().int().min(3).max(730).optional(),
  watchParseSpikePct: z.number().int().min(10).max(100).optional(),
  quietPauseOnFacebook: z.boolean().optional(),
  quietWindow: z.string().max(200).regex(/^(\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*)?(,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*)*$/, "รูปแบบเวลาเช่น 19:00-23:00").optional(),
  quietPauseWhenLocked: z.boolean().optional(),
  summaryTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

export async function PUT(request: Request) {
  const error = await commentMutationGuard(request);
  if (error) return error;
  const parsed = putSchema.safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return json({ error: "ค่าที่ส่งมาไม่ถูกต้อง" }, 400);
  const body = parsed.data;
  const entries: Record<string, string> = {};
  const set = (key: string, value: string | number | boolean | undefined) => {
    if (value === undefined) return;
    entries[key] = String(value);
  };
  set("fetch_interval_minutes", body.fetchIntervalMinutes);
  set("jitter_minutes", body.jitterMinutes);
  set("max_groups_per_cycle", body.maxGroupsPerCycle);
  set("scroll_screens", body.scrollScreens);
  set("max_post_age_hours", body.maxPostAgeHours);
  set("max_posts_per_run", body.maxPostsPerRun);
  set("line_user_id", body.lineUserId?.trim());
  if (body.updateLineToken) entries.line_token = body.lineToken?.trim() ?? "";
  if (body.updateDiscordWebhook || body.discordWebhook?.trim()) set("discord_webhook", body.discordWebhook?.trim() ?? "");
  set("notify_email_to", body.notifyEmailTo?.trim());
  set("smtp_host", body.smtpHost?.trim());
  set("smtp_port", body.smtpPort);
  set("smtp_user", body.smtpUser?.trim());
  if (body.updateSmtpPass) entries.smtp_pass = body.smtpPass?.trim() ?? "";
  set("notify_sound", body.notifySound);
  set("notify_min_score", body.notifyMinScore);
  set("watch_enabled", body.watchEnabled);
  set("watch_no_posts_hours", body.watchNoPostsHours);
  set("watch_ext_offline_minutes", body.watchExtOfflineMinutes);
  set("watch_alert_every_hours", body.watchAlertEveryHours);
  set("post_retention_days", body.postRetentionDays);
  set("lead_retention_days", body.leadRetentionDays);
  set("watch_parse_spike_pct", body.watchParseSpikePct);
  set("quiet_pause_on_facebook", body.quietPauseOnFacebook);
  set("quiet_window", body.quietWindow);
  set("quiet_pause_when_locked", body.quietPauseWhenLocked);
  set("summary_time", body.summaryTime);
  try {
    await upsertSettings(entries, (await getSession())!.ownerId);
    return json({ settings: publicSettings(await getSettings()) });
  } catch { return json({ error: "บันทึกไม่สำเร็จ ตรวจ AI_KEY_SECRET และฐานข้อมูล" }, 400); }
}
