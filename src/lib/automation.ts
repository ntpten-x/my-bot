import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { renderTemplate } from "./templates";
import { workerLog } from "./log";
import { dispatchNotification } from "./notify";
import { RULE_PREFIX, queueExternalNotification } from "./notification-queue";

// Owner-defined rules ("กฎอัตโนมัติ"). Actions stay on this machine: notify the owner,
// put the lead in the pipeline, prepare a reply draft, or hide it. Nothing is ever posted
// to Facebook or any other site on the owner's behalf.
export const MAX_RULES = 30;
// Pipeline stages that still need a follow-up reminder.
export const OPEN_STATUSES = ["following", "replied", "contacted"];
export const RULE_TITLE_PREFIX = RULE_PREFIX;

export type RuleLike = {
  enabled: boolean;
  categoryId: string | null;
  keywords: string;
  provinces: string;
  intent: string;
  minScore: number;
  subcategoryId?: string | null;
  productId?: string | null;
  sourceIds?: string;
  excludeKeywords?: string;
  maxAgeHours?: number;
};

export type RulePost = {
  text: string;
  ocrText: string;
  categoryId: string | null;
  subcategoryId: string | null;
  province: string | null;
  intent: string;
  score: number;
  isAd: boolean;
  forbiddenHit: boolean;
  duplicateOfId: string | null;
  productId?: string | null;
  sourceId?: string;
  postedAt?: Date | null;
  createdAt?: Date;
};

export function splitList(value: string) {
  return value.split(/[,\n|]/).map((part) => part.trim()).filter(Boolean);
}

export function matchRule(rule: RuleLike, post: RulePost, now = Date.now()) {
  if (!rule.enabled || post.isAd || post.forbiddenHit || post.duplicateOfId) return false;
  if (rule.categoryId && post.categoryId !== rule.categoryId && post.subcategoryId !== rule.categoryId) return false;
  if (rule.subcategoryId && post.subcategoryId !== rule.subcategoryId) return false;
  if (rule.productId && post.productId !== rule.productId) return false;
  const sources = splitList(rule.sourceIds ?? "");
  if (sources.length && (!post.sourceId || !sources.includes(post.sourceId))) return false;
  if (rule.maxAgeHours && rule.maxAgeHours > 0) {
    const at = post.postedAt ?? post.createdAt;
    if (at && now - at.getTime() > rule.maxAgeHours * 3_600_000) return false;
  }
  const excluded = splitList(rule.excludeKeywords ?? "").map((word) => word.toLowerCase().replace(/\s+/g, " "));
  if (excluded.length) {
    const haystack = `${post.text}\n${post.ocrText}`.toLowerCase().replace(/\s+/g, " ");
    if (excluded.some((word) => haystack.includes(word))) return false;
  }
  if (rule.intent && post.intent !== rule.intent) return false;
  if (post.score < rule.minScore) return false;
  const provinces = splitList(rule.provinces);
  if (provinces.length && (!post.province || !provinces.includes(post.province))) return false;
  const keywords = splitList(rule.keywords).map((word) => word.toLowerCase());
  if (keywords.length) {
    const haystack = `${post.text}\n${post.ocrText}`.toLowerCase().replace(/\s+/g, " ");
    if (!keywords.some((word) => haystack.includes(word.replace(/\s+/g, " ")))) return false;
  }
  return true;
}

/** Queue rules in run order: priority asc, then oldest first. */
export function sortQueueRules<T extends { priority?: number; createdAt?: Date }>(rules: T[]) {
  return [...rules].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
}

/** First (highest priority) enabled queue rule this post matches, or null. */
export function queueRuleFor<T extends RuleLike & { actionQueue?: boolean; priority?: number; createdAt?: Date }>(rules: T[], post: RulePost, now = Date.now()) {
  return sortQueueRules(rules.filter((rule) => rule.actionQueue)).find((rule) => matchRule(rule, post, now)) ?? null;
}

export function followUpDate(days: number, from = new Date()) {
  return days > 0 ? new Date(from.getTime() + days * 86_400_000) : null;
}

export async function applyAutomationRules(postIds: string[]) {
  if (!postIds.length) return 0;
  const rules = await prisma.automationRule.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } });
  if (!rules.length) return 0;
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds }, duplicateOfId: null },
    include: { category: true, subcategory: true, source: true, product: { select: { name: true } } },
  });
  if (!posts.length) return 0;
  const templateIds = [...new Set(rules.map((rule) => rule.templateId).filter((id): id is string => Boolean(id)))];
  const templates = templateIds.length ? await prisma.replyTemplate.findMany({ where: { id: { in: templateIds } } }) : [];
  const settings = await getSettings();
  let hits = 0;
  for (const post of posts) {
    for (const rule of rules) {
      if (!matchRule(rule, post)) continue;
      try {
        await prisma.ruleHit.create({ data: { ruleId: rule.id, postId: post.id } });
      } catch {
        continue; // already applied to this post
      }
      hits += 1;
      const data: Record<string, unknown> = {};
      if (rule.actionDismiss) data.dismissed = true;
      if (rule.actionSave && !rule.actionDismiss && post.pipelineStatus === "none") {
        data.pipelineStatus = "following";
        data.isSaved = true;
        data.statusChangedAt = new Date();
        data.followUpAt = followUpDate(settings.followUpDays);
      }
      const template = templates.find((item) => item.id === rule.templateId);
      if (template) {
        data.suggestedReply = renderTemplate(template.body, {
          category: post.category?.name,
          subcategory: post.subcategory?.name,
          province: post.province,
          author: post.authorName,
          source: post.source?.name,
          product: post.product?.name,
        });
      }
      if (Object.keys(data).length) await prisma.post.update({ where: { id: post.id }, data });
      await prisma.automationRule.update({ where: { id: rule.id }, data: { hitCount: { increment: 1 }, lastHitAt: new Date() } });
      if (rule.actionNotify && !rule.actionDismiss) {
        const title = `${RULE_TITLE_PREFIX}${rule.name}`.slice(0, 120);
        await dispatchNotification({ ...post, suggestedReply: typeof data.suggestedReply === "string" ? data.suggestedReply : post.suggestedReply }, settings, title);
        await queueExternalNotification(post.id, title);
      }
      await workerLog({ postId: post.id, message: `ตรงกฎ "${rule.name}"` }).catch(() => undefined);
    }
  }
  return hits;
}

// Reminder for leads the owner is following but has not moved for a while.
export async function processFollowUps(limit = 20) {
  const due = await prisma.post.findMany({
    where: { followUpAt: { lte: new Date() }, pipelineStatus: { in: OPEN_STATUSES }, dismissed: false },
    orderBy: { followUpAt: "asc" },
    take: limit,
    select: { id: true, authorName: true, text: true, pipelineStatus: true },
  });
  for (const post of due) {
    const status = post.pipelineStatus === "contacted" ? "ทักไปแล้ว" : post.pipelineStatus === "replied" ? "ตอบคอมเมนต์แล้ว" : "ติดตาม";
    await prisma.notification.create({
      data: {
        postId: post.id,
        channel: "in_app",
        title: "ถึงเวลาตามลีด",
        body: `${status}: ${post.authorName || "ไม่ระบุชื่อ"} - ${post.text.replace(/\s+/g, " ").slice(0, 120)}`,
      },
    });
    await prisma.post.update({ where: { id: post.id }, data: { followUpAt: null } });
  }
  return due.length;
}
