import { commentMutationGuard } from "@/lib/auto-comment/api-guard";
import { json } from "@/lib/http";
import { autoCommentRuleSchema } from "@/lib/auto-comment/schema";
import { saveCommentRule } from "@/lib/auto-comment/admin";

export const dynamic = "force-dynamic";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const error = await commentMutationGuard(request); if (error) return error;
  const parsed = autoCommentRuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลกฎไม่ถูกต้อง" }, 400);
  const { id } = await context.params;
  try { return json({ id: await saveCommentRule(parsed.data, id) }); }
  catch { return json({ error: "แก้ไขกฎไม่สำเร็จ ตรวจการตั้งค่าและ Secret สำหรับเข้ารหัส Token" }, 400); }
}
