import { commentMutationGuard } from "@/lib/auto-comment/api-guard";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { autoCommentDashboard } from "@/lib/auto-comment/engine";
import { commentControlSchema } from "@/lib/auto-comment/schema";
import { updateCommentControl } from "@/lib/auto-comment/control";

export const dynamic = "force-dynamic";
export async function GET() {
  const { error } = await authed(); if (error) return error;
  return json(await autoCommentDashboard());
}
export async function PUT(request: Request) {
  const error = await commentMutationGuard(request); if (error) return error;
  const parsed = commentControlSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "การตั้งค่าหรือคำสั่งไม่ถูกต้อง" }, 400);
  try { return json({ control: await updateCommentControl(parsed.data) }); }
  catch { return json({ error: "เปลี่ยนสถานะไม่สำเร็จ: ตรวจการยืนยันส่งจริง และปลด Emergency Stop ขณะหยุดก่อน Start" }, 400); }
}
