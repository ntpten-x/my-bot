import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import type { AppSettings } from "./settings";
import { buildLeadEmbed, buildSummaryEmbed, sendDiscordContent, sendDiscordEmbed } from "./discord";

type LeadNotice = {
  id: string | null;
  text: string;
  externalUrl: string;
  intent: string;
  province: string | null;
  category?: { name: string } | null;
  subcategory?: { name: string } | null;
  source?: { name: string } | null;
  score?: number;
  suggestedReply?: string;
};

const INTENT_LABEL: Record<string, string> = {
  buyer: "กำลังหา",
  seller: "กำลังขาย",
  unknown: "ไม่ชัด",
};

function messageFor(post: LeadNotice) {
  const category = [post.category?.name, post.subcategory?.name].filter(Boolean).join(" / ") || "อื่นๆ";
  const snippet = post.text.replace(/\s+/g, " ").trim().slice(0, 280);
  return [
    "MY-BOT พบลีดใหม่",
    `หมวด: ${category}`,
    `เจตนา: ${INTENT_LABEL[post.intent] ?? post.intent}`,
    `จังหวัด: ${post.province ?? "-"}`,
    `แหล่ง: ${post.source?.name ?? "-"}`,
    snippet,
    post.externalUrl,
  ].join("\n");
}

export type ChannelResult = { ok: boolean; skipped?: boolean; message: string };

async function pushLine(settings: AppSettings, text: string): Promise<ChannelResult> {
  if (!settings.lineToken || !settings.lineUserId) return { ok: false, skipped: true, message: "ยังไม่ตั้ง LINE token หรือ user id" };
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.lineToken}`,
    },
    body: JSON.stringify({
      to: settings.lineUserId,
      messages: [{ type: "text", text: text.slice(0, 4900) }],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, message: `LINE ${response.status} ${body.replace(/\s+/g, " ").slice(0, 180)}` };
  }
  return { ok: true, message: "ส่ง LINE แล้ว" };
}

async function pushDiscord(
  settings: AppSettings,
  text: string,
  post: LeadNotice,
  title: string,
  mode: "auto" | "embed" | "text",
): Promise<ChannelResult> {
  if (!settings.discordWebhook) return { ok: false, skipped: true, message: "ยังไม่ตั้ง Discord webhook" };
  const useEmbed = mode === "embed" || (mode !== "text" && ((post.score ?? 0) >= 80 || title.startsWith("สรุป")));
  if (!useEmbed) return sendDiscordContent(settings.discordWebhook, text);
  const embed = title.startsWith("สรุป")
    ? buildSummaryEmbed(title, text)
    : buildLeadEmbed({
        title,
        text: post.text,
        url: post.externalUrl,
        score: post.score ?? 0,
        category: [post.category?.name, post.subcategory?.name].filter(Boolean).join(" / "),
        province: post.province,
        intent: post.intent,
        group: post.source?.name,
        reply: post.suggestedReply,
      });
  return sendDiscordEmbed(settings.discordWebhook, embed);
}

async function pushEmail(settings: AppSettings, subject: string, text: string): Promise<ChannelResult> {
  if (!settings.smtpHost || !settings.notifyEmailTo) return { ok: false, skipped: true, message: "ยังไม่ตั้งอีเมล" };
  try {
    const transport = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpPort === 465,
      auth: settings.smtpUser ? { user: settings.smtpUser, pass: settings.smtpPass } : undefined,
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      socketTimeout: 12_000,
    });
    await transport.sendMail({
      from: settings.smtpUser || settings.notifyEmailTo,
      to: settings.notifyEmailTo,
      subject,
      text,
    });
    return { ok: true, message: "ส่งอีเมลแล้ว" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "ส่งอีเมลไม่สำเร็จ" };
  }
}

export async function dispatchNotification(
  post: LeadNotice,
  settings: AppSettings,
  title = "ลีดใหม่",
  options: { external?: boolean; forceExternal?: boolean; discordMode?: "auto" | "embed" | "text"; skipInApp?: boolean; skipChannels?: string[] } = {},
) {
  const body = messageFor(post);
  if (!options.skipInApp) await prisma.notification.create({
    data: { postId: post.id, channel: "in_app", title, body },
  });
  const channels: Record<string, ChannelResult> = {};
  if (!options.external && !options.forceExternal) return { channels };
  const senders: Array<["line" | "discord" | "email", () => Promise<ChannelResult>]> = [
    ["line", () => pushLine(settings, body)],
    ["discord", () => pushDiscord(settings, body, post, title, options.discordMode ?? "auto")],
    ["email", () => pushEmail(settings, `MY-BOT: ${title}`, body)],
  ];
  const jobs = senders.filter(([name]) => !options.skipChannels?.includes(name))
    .map(([name, send]) => [name, send().catch((): ChannelResult => ({ ok: false, message: "ส่งช่องทางนี้ไม่สำเร็จ" }))] as const);
  for (const [name, job] of jobs) {
    const result = await job;
    channels[name] = result;
    if (result.skipped && !options.forceExternal) continue;
    if (result.ok) {
      await prisma.notification.create({ data: { postId: post.id, channel: name, title, body } });
    } else if (!result.skipped) {
      console.error(`[notify] ${name}: ${result.message}`);
    }
  }
  return { channels };
}

export function keywordHitsOf(post: { keywordHitsJson: string }) {
  try {
    const parsed = JSON.parse(post.keywordHitsJson);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function shouldNotify(post: { isAd: boolean; forbiddenHit: boolean; intent: string; keywordHitsJson: string }) {
  if (post.isAd || post.forbiddenHit || post.intent === "ad") return false;
  return keywordHitsOf(post).length > 0 || post.intent === "buyer";
}

export function shouldNotifyExternal(post: { isAd: boolean; forbiddenHit: boolean; keywordHitsJson: string }) {
  if (post.isAd || post.forbiddenHit) return false;
  return keywordHitsOf(post).length > 0;
}
