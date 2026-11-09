import { createHash } from "node:crypto";
import { z } from "zod";
import type { AutoCommentJob, AutoCommentRule, Post } from "@prisma/client";

export const DRAFT_VERSION = "comment-facts-v1";
export function draftKey(rule: AutoCommentRule, post: Post) {
  return createHash("sha256").update(JSON.stringify([DRAFT_VERSION, rule.id, rule.revision, rule.businessFacts, rule.draftInstruction, post.id, post.textRevision, post.text, post.intent, post.suggestedReply])).digest("hex");
}
const output = z.object({ message: z.string().trim().min(1).max(2000), relevant: z.literal(true), confidence: z.number().min(0.9).max(1), evidence: z.array(z.string().min(2).max(300)).min(1).max(5) }).strict();
export function validatedDraft(raw: unknown, facts: string, text: string) {
  const value = output.parse(raw);
  if (!value.evidence.every(quote => text.includes(quote))) throw new Error("หลักฐานไม่ตรงโพสต์");
  const urls = value.message.match(/https?:\/\/[^\s<>]+/g) ?? [];
  if (urls.some(url => !facts.includes(url))) throw new Error("ลิงก์ไม่ได้รับรอง");
  const numbers = value.message.replace(/https?:\/\/\S+/g, "").match(/\d+(?:[.,]\d+)*/g) ?? [];
  if (numbers.some(number => !facts.includes(number))) throw new Error("ตัวเลขไม่ได้รับรอง");
  // This is evidence validation, not a guarantee of factuality; calibrated review remains necessary.
  return value;
}
export async function generateCommentDraft(_rule: AutoCommentRule, _post: Post, _assertActive: () => Promise<void>): Promise<{ message: string; provider: string; key: string }> { void _rule; void _post; void _assertActive;  throw new Error("AI_REMOVED"); }
export function draftStillValid(job: AutoCommentJob, rule: AutoCommentRule, post: Post) {
  return Boolean(job.draftInputKey && job.draftInputKey === draftKey(rule, post));
}
