import { createHash, randomInt } from "node:crypto";
import { normalizeText } from "../pipeline/normalize";

export type MatchRule = {
  enabled: boolean; pausedReason: string; sourceIdsJson: string; keywords: string; excludeKeywords: string;
  keywordMode: string; startMinute: number; endMinute: number; daysJson: string; maxAgeHours: number;
};
export type MatchPost = { text: string; sourceId: string; createdAt: Date; postedAt: Date | null; isAd: boolean; forbiddenHit: boolean; duplicateOfId: string | null; dismissed: boolean };
export function jsonList<T>(value: string, fallback: T[] = []): T[] {
  try { const out = JSON.parse(value); return Array.isArray(out) ? out : fallback; } catch { return fallback; }
}
export function inCommentWindow(rule: Pick<MatchRule, "startMinute" | "endMinute" | "daysJson">, now = new Date()) {
  const local = new Date(now.getTime() + 7 * 3600_000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  // The day of an overnight window is the day on which that window starts.
  const day = rule.startMinute > rule.endMinute && minute < rule.endMinute ? (local.getUTCDay() + 6) % 7 : local.getUTCDay();
  if (!jsonList<number>(rule.daysJson).includes(day)) return false;
  return rule.startMinute <= rule.endMinute
    ? minute >= rule.startMinute && minute < rule.endMinute
    : minute >= rule.startMinute || minute < rule.endMinute;
}
export function matchesCommentRule(rule: MatchRule, post: MatchPost, now = new Date()) {
  return explainCommentRule(rule, post, now).matched;
}

/** Shared with the worker: explains matching only, never authorizes dispatch. */
export function explainCommentRule(rule: MatchRule, post: MatchPost, now = new Date()) {
  const age = now.getTime() - (post.postedAt ?? post.createdAt).getTime();
  const text = normalizeText(post.text);
  const words = (value: string) => value.split(/[,\n]/).map(normalizeText).filter(Boolean);
  const required = words(rule.keywords);
  const matchedKeywords = required.filter(word => text.includes(word));
  const excludedKeywords = words(rule.excludeKeywords).filter(word => text.includes(word));
  const checks = [
    { code: "enabled", label: "กฎเปิดใช้งาน", passed: rule.enabled },
    { code: "not_paused", label: "กฎไม่ถูกพัก", passed: !rule.pausedReason },
    { code: "not_ad", label: "ไม่ใช่โฆษณา", passed: !post.isAd },
    { code: "not_forbidden", label: "ไม่พบคำต้องห้าม", passed: !post.forbiddenHit },
    { code: "not_duplicate", label: "ไม่ใช่โพสต์ซ้ำ", passed: !post.duplicateOfId },
    { code: "not_dismissed", label: "ไม่ได้ข้ามโพสต์", passed: !post.dismissed },
    { code: "source", label: "แหล่งข้อมูลอยู่ใน Allowlist", passed: jsonList<string>(rule.sourceIdsJson).includes(post.sourceId) },
    { code: "window", label: "อยู่ในวันและเวลาทำงาน (Asia/Bangkok)", passed: inCommentWindow(rule, now) },
    { code: "age", label: "อายุโพสต์อยู่ในช่วงที่รับได้", passed: Number.isFinite(age) && age >= -3600_000 && age <= rule.maxAgeHours * 3600_000 },
    { code: "excluded", label: "ไม่พบคำยกเว้น", passed: !excludedKeywords.length },
    { code: "keywords", label: rule.keywordMode === "all" ? "พบคำสำคัญครบทุกคำ" : "พบคำสำคัญอย่างน้อยหนึ่งคำ หรือไม่ได้กำหนดคำ", passed: !required.length || (rule.keywordMode === "all" ? matchedKeywords.length === required.length : matchedKeywords.length > 0) },
  ];
  return { matched: checks.every(check => check.passed), checks, matchedKeywords, excludedKeywords };
}
export function templateIndex(mode: string, count: number, next: number, random = randomInt) {
  if (!count) throw new Error("ไม่มีข้อความคอมเมนต์");
  return mode === "random" ? random(count) : next % count;
}
export function commentTarget(url: string, sourceType: string, pageId: string) {
  try {
    const parsed = new URL(url);
    if (!["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"].includes(parsed.hostname)) throw new Error();
    if (sourceType !== "facebook_page" || !/^\d+$/.test(pageId) || /\/groups\/|\/marketplace\//i.test(parsed.pathname)) throw new Error();
    const post = parsed.pathname.match(new RegExp(`^/${pageId}/posts/(\\d+)(?:/)?$`))?.[1]
      ?? (parsed.pathname === "/story.php" && parsed.searchParams.get("id") === pageId ? parsed.searchParams.get("story_fbid") : null);
    if (!post || !/^\d+$/.test(post)) throw new Error();
    return { supported: true, remotePostId: `${pageId}_${post}`, postKey: `${pageId}_${post}` };
  } catch {
    const normalized = url.split("#")[0];
    return { supported: false, remotePostId: "", postKey: createHash("sha256").update(normalized).digest("hex") };
  }
}
