import { prisma } from "./prisma";
import { parseProvinceList } from "./service-area";
import { parseTimes } from "./reply-queue-core";
import { decodeSetting, encodeSetting } from "./setting-secrets";

export type AiProviderName = "auto" | "ollama" | "gemini" | "groq" | "rules";

export type AppSettings = {
  aiProvider: AiProviderName;
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiModel: string;
  geminiApiKey: string;
  groqModel: string;
  groqApiKey: string;
  fetchIntervalMinutes: number;
  jitterMinutes: number;
  maxGroupsPerCycle: number;
  scrollScreens: number;
  maxPostAgeHours: number;
  maxPostsPerRun: number;
  extensionToken: string;
  lineToken: string;
  lineUserId: string;
  discordWebhook: string;
  notifyEmailTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  notifySound: boolean;
  notifyMinScore: number;
  summaryTime: string;
  embedModel: string;
  geminiEmbedModel: string;
  ocrEnabled: boolean;
  visionOcr: boolean;
  lastBackupAt: string;
  lastBackupFile: string;
  embedLastOk: boolean;
  embedLastMessage: string;
  embedLastAt: string;
  serviceProvinces: string[];
  serviceAreaNotifyOnly: boolean;
  followUpDays: number;
  replyQueueEnabled: boolean;
  replyQueueTimes: string[];
  replyDailyCap: number;
  replyGapMinMinutes: number;
  replyGapMaxMinutes: number;
  replyAuthorDays: number;
  replyGroupDailyCap: number;
  replyMinScore: number;
  replyAutoAdvance: boolean;
  replyAutoMarkSent: boolean;
  replyAutoInsert: boolean;
  watchEnabled: boolean;
  watchNoPostsHours: number;
  watchExtOfflineMinutes: number;
  watchAlertEveryHours: number;
  postRetentionDays: number;
  leadRetentionDays: number;
  watchParseSpikePct: number;
  quietPauseOnFacebook: boolean;
  quietWindow: string;
  quietPauseWhenLocked: boolean;
};

function pick(db: string | undefined, env: string | undefined, fallback = "") {
  if (db && db.trim()) return db.trim();
  if (env && env.trim()) return env.trim();
  return fallback;
}

function num(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export async function readSettingMap() {
  const rows = await prisma.setting.findMany();
  // Retired model keys are not needed, including unreadable keys from old hosts.
  return Object.fromEntries(rows.filter(row => !["gemini_api_key", "groq_api_key"].includes(row.key))
    .map((row) => [row.key, decodeSetting(row.key, row.value)]));
}

export async function getSettings(): Promise<AppSettings> {
  const map = await readSettingMap();
  const env = process.env;
  // Legacy fields remain readable for backup compatibility; AI is no longer a runtime capability.
  return {
    aiProvider: "rules",
    ollamaBaseUrl: "",
    ollamaModel: "",
    geminiModel: "",
    geminiApiKey: "",
    groqModel: "",
    groqApiKey: "",
    fetchIntervalMinutes: num(map.fetch_interval_minutes, 10, 5, 180),
    jitterMinutes: num(map.jitter_minutes, 1, 0, 30),
    maxGroupsPerCycle: num(map.max_groups_per_cycle, 20, 1, 20),
    scrollScreens: num(map.scroll_screens, 5, 0, 10),
    maxPostAgeHours: num(map.max_post_age_hours, 24, 1, 24),
    maxPostsPerRun: num(map.max_posts_per_run, 40, 5, 200),
    extensionToken: pick(map.extension_token, undefined),
    lineToken: pick(map.line_token, env.LINE_CHANNEL_ACCESS_TOKEN),
    lineUserId: pick(map.line_user_id, env.LINE_USER_ID),
    discordWebhook: pick(map.discord_webhook, env.DISCORD_WEBHOOK_URL),
    notifyEmailTo: pick(map.notify_email_to, env.NOTIFY_EMAIL_TO),
    smtpHost: pick(map.smtp_host, env.SMTP_HOST),
    smtpPort: num(map.smtp_port || env.SMTP_PORT, 587, 1, 65535),
    smtpUser: pick(map.smtp_user, env.SMTP_USER),
    smtpPass: pick(map.smtp_pass, env.SMTP_PASS),
    notifySound: map.notify_sound !== "false",
    notifyMinScore: num(map.notify_min_score, 50, 0, 100),
    summaryTime: /^\d{2}:\d{2}$/.test(pick(map.summary_time, undefined, "08:00")) ? pick(map.summary_time, undefined, "08:00") : "08:00",
    embedModel: "",
    geminiEmbedModel: "",
    ocrEnabled: false,
    visionOcr: false,
    lastBackupAt: map.backup_last_at || "",
    lastBackupFile: map.backup_last_file || "",
    embedLastOk: map.embed_last_ok === "true",
    embedLastMessage: map.embed_last_message || "",
    embedLastAt: map.embed_last_at || "",
    serviceProvinces: parseProvinceList(map.service_provinces),
    serviceAreaNotifyOnly: map.service_area_notify_only !== "false",
    followUpDays: num(map.follow_up_days, 2, 0, 30),
    replyQueueEnabled: map.reply_queue_enabled === "true",
    replyQueueTimes: parseTimes(map.reply_queue_times ?? "09:00,18:00"),
    replyDailyCap: num(map.reply_daily_cap, 20, 1, 100),
    replyGapMinMinutes: num(map.reply_gap_min_minutes, 2, 0, 120),
    replyGapMaxMinutes: Math.max(num(map.reply_gap_min_minutes, 2, 0, 120), num(map.reply_gap_max_minutes, 5, 0, 180)),
    replyAuthorDays: num(map.reply_author_days, 7, 0, 90),
    replyGroupDailyCap: num(map.reply_group_daily_cap, 5, 1, 50),
    replyMinScore: num(map.reply_min_score, 60, 0, 100),
    replyAutoAdvance: map.reply_auto_advance !== "false",
    replyAutoMarkSent: map.reply_auto_mark_sent === "true",
    replyAutoInsert: map.reply_auto_insert === "true",
    watchEnabled: map.watch_enabled !== "false",
    watchNoPostsHours: num(map.watch_no_posts_hours, 6, 1, 48),
    watchExtOfflineMinutes: num(map.watch_ext_offline_minutes, 30, 5, 720),
    watchAlertEveryHours: num(map.watch_alert_every_hours, 6, 1, 48),
    postRetentionDays: num(map.post_retention_days, 3, 3, 365),
    leadRetentionDays: num(map.lead_retention_days, 90, 3, 730),
    watchParseSpikePct: num(map.watch_parse_spike_pct, 30, 10, 100),
    quietPauseOnFacebook: map.quiet_pause_on_facebook !== "false",
    quietWindow: String(map.quiet_window ?? "").slice(0, 200),
    quietPauseWhenLocked: map.quiet_pause_when_locked === "true",
  };
}

export async function upsertSettings(entries: Record<string, string>) {
  await prisma.$transaction(
    Object.entries(entries).map(([key, plain]) => {
      const value = encodeSetting(key, plain);
      return (
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      }));
    }),
  );
}

export function publicSettings(settings: AppSettings) {
  return {
    fetchIntervalMinutes: settings.fetchIntervalMinutes,
    jitterMinutes: settings.jitterMinutes,
    maxGroupsPerCycle: settings.maxGroupsPerCycle,
    scrollScreens: settings.scrollScreens,
    maxPostAgeHours: settings.maxPostAgeHours,
    maxPostsPerRun: settings.maxPostsPerRun,
    extensionToken: settings.extensionToken,
    lineUserId: settings.lineUserId,
    lineTokenSet: Boolean(settings.lineToken),
    discordWebhook: "",
    discordWebhookSet: Boolean(settings.discordWebhook),
    notifyEmailTo: settings.notifyEmailTo,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpPassSet: Boolean(settings.smtpPass),
    notifySound: settings.notifySound,
    notifyMinScore: settings.notifyMinScore,
    summaryTime: settings.summaryTime,
    lastBackupAt: settings.lastBackupAt,
    lastBackupFile: settings.lastBackupFile,
    serviceProvinces: settings.serviceProvinces,
    serviceAreaNotifyOnly: settings.serviceAreaNotifyOnly,
    followUpDays: settings.followUpDays,
    replyQueueEnabled: settings.replyQueueEnabled,
    replyQueueTimes: settings.replyQueueTimes,
    replyDailyCap: settings.replyDailyCap,
    replyGapMinMinutes: settings.replyGapMinMinutes,
    replyGapMaxMinutes: settings.replyGapMaxMinutes,
    replyAuthorDays: settings.replyAuthorDays,
    replyGroupDailyCap: settings.replyGroupDailyCap,
    replyMinScore: settings.replyMinScore,
    replyAutoAdvance: settings.replyAutoAdvance,
    replyAutoMarkSent: settings.replyAutoMarkSent,
    replyAutoInsert: settings.replyAutoInsert,
    watchEnabled: settings.watchEnabled,
    watchNoPostsHours: settings.watchNoPostsHours,
    watchExtOfflineMinutes: settings.watchExtOfflineMinutes,
    watchAlertEveryHours: settings.watchAlertEveryHours,
    postRetentionDays: settings.postRetentionDays,
    leadRetentionDays: settings.leadRetentionDays,
    watchParseSpikePct: settings.watchParseSpikePct,
    quietPauseOnFacebook: settings.quietPauseOnFacebook,
    quietWindow: settings.quietWindow,
    quietPauseWhenLocked: settings.quietPauseWhenLocked,
  };
}
