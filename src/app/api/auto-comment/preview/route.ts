import { z } from "zod";
import { commentMutationGuard } from "@/lib/auto-comment/api-guard";
import { explainCommentRule } from "@/lib/auto-comment/matching";
import { prisma } from "@/lib/prisma";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";
const inputSchema = z.object({
  ruleId: z.string().min(1).max(100), sourceId: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(20000),
  postedAt: z.iso.datetime({ offset: true }).optional(),
  isAd: z.boolean().default(false), forbiddenHit: z.boolean().default(false),
  duplicate: z.boolean().default(false), dismissed: z.boolean().default(false),
}).strict();

/** Synthetic input + saved rule. No posts/jobs/logs written; no provider calls. */
export async function POST(request: Request) {
  const error = await commentMutationGuard(request); if (error) return error;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "ข้อมูลทดลองไม่ถูกต้อง เลือกกฎ แหล่งข้อมูล และข้อความไม่เกิน 20,000 ตัวอักษร" }, 400);
  try {
    const rule = await prisma.autoCommentRule.findUnique({ where: { id: input.data.ruleId }, select: {
      enabled: true, pausedReason: true, sourceIdsJson: true, keywords: true, excludeKeywords: true,
      keywordMode: true, startMinute: true, endMinute: true, daysJson: true, maxAgeHours: true,
    } });
    if (!rule) return json({ error: "ไม่พบกฎที่เลือก" }, 404);
    const now = new Date();
    const result = explainCommentRule(rule, {
      ...input.data, createdAt: now, postedAt: input.data.postedAt ? new Date(input.data.postedAt) : null,
      duplicateOfId: input.data.duplicate ? "synthetic-duplicate" : null,
    }, now);
    const response = json({ ...result, evaluatedAt: now.toISOString(), dispatchAuthorized: false });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return json({ error: "ทดลองกฎไม่สำเร็จ กรุณาลองใหม่" }, 500); }
}
