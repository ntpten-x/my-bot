import { commentMutationGuard } from "@/lib/auto-comment/api-guard";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { autoCommentDashboard } from "@/lib/auto-comment/engine";
import { commentControlSchema } from "@/lib/auto-comment/schema";
import { updateCommentControl } from "@/lib/auto-comment/control";
import { schemaReadiness } from "@/lib/schema-readiness";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { error } = await authed(); if (error) return error;
  try {
    const schema = await schemaReadiness();
    if (!schema.ready) return json({ error: "ฐานข้อมูลคอมเมนต์ยังไม่พร้อม ต้องรัน migration บนเซิร์ฟเวอร์", code: "SCHEMA_NOT_READY", schema }, 503);
    const url = new URL(request.url);
    const jobsOffset = Number(url.searchParams.get("jobsOffset") || 0);
    const logsOffset = Number(url.searchParams.get("logsOffset") || 0);
    const dashboard = await autoCommentDashboard({
      jobsOffset: Number.isFinite(jobsOffset) ? jobsOffset : 0,
      logsOffset: Number.isFinite(logsOffset) ? logsOffset : 0,
    });
    return json({ ...dashboard, control: { ...dashboard.control, dryRun: false, ...(dashboard.control.dryRun ? { state: "stopped" } : {}) } });
  } catch { return json({ error: "โหลดระบบคอมเมนต์ไม่สำเร็จ กรุณาตรวจฐานข้อมูล" }, 503); }
}
export async function PUT(request: Request) {
  const error = await commentMutationGuard(request); if (error) return error;
  const parsed = commentControlSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "การตั้งค่าหรือคำสั่งไม่ถูกต้อง" }, 400);
  try { return json({ control: await updateCommentControl({ ...parsed.data, dryRun: false, liveAcknowledged: true, liveOnly: true }) }); }
  catch { return json({ error: "เปลี่ยนสถานะไม่สำเร็จ: ปลด Emergency Stop ขณะหยุดก่อน Start" }, 400); }
}
