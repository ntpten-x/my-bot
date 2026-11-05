import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { getSettings, publicSettings, upsertSettings } from "@/lib/settings";
import { clearProviderHealthCache } from "@/lib/ai/health";
import { clearOllamaUrlCache } from "@/lib/ai/ollama-url";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  return json({ settings: publicSettings(await getSettings()) });
}

const putSchema = z.object({
  aiProvider: z.enum(["auto", "ollama", "gemini", "groq", "rules"]).optional(),
  ollamaBaseUrl: z.string().optional(),
  ollamaModel: z.string().optional(),
  geminiModel: z.string().optional(),
  groqModel: z.string().optional(),
  updateGeminiKey: z.boolean().optional(),
  geminiApiKey: z.string().optional(),
  updateGroqKey: z.boolean().optional(),
  groqApiKey: z.string().optional(),
  fetchIntervalMinutes: z.number().int().min(5).max(180).optional(),
  jitterMinutes: z.number().int().min(0).max(30).optional(),
  maxGroupsPerCycle: z.number().int().min(1).max(10).optional(),
  scrollScreens: z.number().int().min(0).max(10).optional(),
  maxPostAgeHours: z.number().int().min(1).max(168).optional(),
  maxPostsPerRun: z.number().int().min(5).max(40).optional(),
  lineUserId: z.string().optional(),
  updateLineToken: z.boolean().optional(),
  lineToken: z.string().optional(),
  discordWebhook: z.string().optional(),
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
  watchParseSpikePct: z.number().int().min(10).max(100).optional(),
  quietPauseOnFacebook: z.boolean().optional(),
  quietWindow: z.string().max(200).regex(/^(\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*)?(,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*)*$/, "รูปแบบเวลาเช่น 19:00-23:00").optional(),
  quietPauseWhenLocked: z.boolean().optional(),
  summaryTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  embedModel: z.string().optional(),
  geminiEmbedModel: z.string().optional(),
  ocrEnabled: z.boolean().optional(),
  visionOcr: z.boolean().optional(),
});

export async function PUT(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ค่าที่ส่งมาไม่ถูกต้อง" }, 400);
  const body = parsed.data;
  const entries: Record<string, string> = {};
  const set = (key: string, value: string | number | boolean | undefined) => {
    if (value === undefined) return;
    entries[key] = String(value);
  };
  set("ai_provider", body.aiProvider);
  set("ollama_base_url", body.ollamaBaseUrl?.trim());
  set("ollama_model", body.ollamaModel?.trim());
  set("gemini_model", body.geminiModel?.trim());
  set("groq_model", body.groqModel?.trim());
  if (body.updateGeminiKey) entries.gemini_api_key = body.geminiApiKey?.trim() ?? "";
  if (body.updateGroqKey) entries.groq_api_key = body.groqApiKey?.trim() ?? "";
  set("fetch_interval_minutes", body.fetchIntervalMinutes);
  set("jitter_minutes", body.jitterMinutes);
  set("max_groups_per_cycle", body.maxGroupsPerCycle);
  set("scroll_screens", body.scrollScreens);
  set("max_post_age_hours", body.maxPostAgeHours);
  set("max_posts_per_run", body.maxPostsPerRun);
  set("line_user_id", body.lineUserId?.trim());
  if (body.updateLineToken) entries.line_token = body.lineToken?.trim() ?? "";
  set("discord_webhook", body.discordWebhook?.trim());
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
  set("watch_parse_spike_pct", body.watchParseSpikePct);
  set("quiet_pause_on_facebook", body.quietPauseOnFacebook);
  set("quiet_window", body.quietWindow);
  set("quiet_pause_when_locked", body.quietPauseWhenLocked);
  set("summary_time", body.summaryTime);
  set("embed_model", body.embedModel?.trim());
  set("gemini_embed_model", body.geminiEmbedModel?.trim());
  set("ocr_enabled", body.ocrEnabled);
  set("vision_ocr", body.visionOcr);
  clearProviderHealthCache();
  clearOllamaUrlCache();
  await upsertSettings(entries);
  return json({ settings: publicSettings(await getSettings()) });
}
