import { z } from "zod";
import { commentMutationGuard } from "@/lib/auto-comment/api-guard";
import { json } from "@/lib/http";
import { autoCommentRuleSchema } from "@/lib/auto-comment/schema";
import { saveCommentRule, RuleSetupError, setCommentRuleEnabled, RuleToggleError, deleteCommentRule } from "@/lib/auto-comment/admin";

export const dynamic = "force-dynamic";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const error = await commentMutationGuard(request); if (error) return error;
  const parsed = autoCommentRuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลกฎไม่ถูกต้อง" }, 400);
  const { id } = await context.params;
  try { return json({ id: await saveCommentRule(parsed.data, id) }); }
  catch (error) { if (error instanceof RuleSetupError) return json({ error: error.message }, 400); return json({ error: "แก้ไขกฎไม่สำเร็จ ตรวจการตั้งค่าและ Secret สำหรับเข้ารหัส Token" }, 400); }
}

const toggleSchema = z.object({ enabled: z.boolean(), revision: z.number().int().positive() }).strict();
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const error = await commentMutationGuard(request); if (error) return error;
  const parsed = toggleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ระบุสถานะและรุ่นของชุดตั้งค่าให้ถูกต้อง" }, 400);
  const { id } = await context.params;
  try { return json(await setCommentRuleEnabled(id, parsed.data.enabled, parsed.data.revision)); }
  catch (error) { return error instanceof RuleToggleError ? json({ error: error.message }, error.status) : json({ error: "เปลี่ยนสถานะไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่" }, 503); }
}

const deleteSchema = z.object({ revision: z.number().int().positive() }).strict();
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const error = await commentMutationGuard(request); if (error) return error;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ระบุรุ่นของชุดตั้งค่าที่ต้องการลบ" }, 400);
  const { id } = await context.params;
  try { return json(await deleteCommentRule(id, parsed.data.revision)); }
  catch (error) { return error instanceof RuleToggleError ? json({ error: error.message }, error.status) : json({ error: "ลบชุดตั้งค่าไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่" }, 503); }
}
