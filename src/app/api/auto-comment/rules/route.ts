import { commentMutationGuard } from "@/lib/auto-comment/api-guard";
import { json } from "@/lib/http";
import { autoCommentRuleSchema } from "@/lib/auto-comment/schema";
import { saveCommentRule, RuleSetupError } from "@/lib/auto-comment/admin";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const error = await commentMutationGuard(request); if (error) return error;
  const parsed = autoCommentRuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลกฎไม่ถูกต้อง ต้องมีข้อความและ Allowlist พร้อมช่วงเวลาที่ถูกต้อง" }, 400);
  try { return json({ id: await saveCommentRule(parsed.data) }, 201); }
  catch (error) { if (error instanceof RuleSetupError) return json({ error: error.message }, 400); return json({ error: "บันทึกกฎไม่สำเร็จ ตรวจแหล่งข้อมูลและ AI_KEY_SECRET ก่อนเก็บ Token" }, 400); }
}
