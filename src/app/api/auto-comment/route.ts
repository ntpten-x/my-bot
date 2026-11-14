import { readJson } from "@/lib/request-body";
import { commentMutationGuard } from "@/lib/auto-comment/api-guard";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { autoCommentDashboard } from "@/lib/auto-comment/engine";
import { COMMENT_JOBS_PAGE_SIZE } from "@/lib/auto-comment/job-status";
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
    const jobsLimit = Number(url.searchParams.get("jobsLimit") || COMMENT_JOBS_PAGE_SIZE);
    const jobFilter = String(url.searchParams.get("jobFilter") || "all");
    const dashboard = await autoCommentDashboard({
      jobsOffset: Number.isFinite(jobsOffset) ? jobsOffset : 0,
      logsOffset: Number.isFinite(logsOffset) ? logsOffset : 0,
      jobsLimit: Number.isFinite(jobsLimit) ? jobsLimit : COMMENT_JOBS_PAGE_SIZE,
      jobFilter,
    });
    return json({ ...dashboard, control: { ...dashboard.control, dryRun: false, ...(dashboard.control.dryRun ? { state: "stopped" } : {}) } });
  } catch { return json({ error: "โหลดระบบคอมเมนต์ไม่สำเร็จ กรุณาตรวจฐานข้อมูล" }, 503); }
}
export async function PUT(request: Request) {
  const error = await commentMutationGuard(request, { recent: false, allowMfaSetup: true }); if (error) return error;
  const parsed = commentControlSchema.safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return json({ error: "การตั้งค่าหรือคำสั่งไม่ถูกต้อง" }, 400);
  const safeStop = ["stop", "pause", "emergency"].includes(parsed.data.action || "") && Object.keys(parsed.data).every(key => key === "action");
  if (!safeStop) { const { error: freshError } = await authed({ recent: true }); if (freshError) return freshError; }
  try { return json({ control: await updateCommentControl({ ...parsed.data, dryRun: false, liveAcknowledged: true, liveOnly: true }) }); }
  catch { return json({ error: "เปลี่ยนสถานะไม่สำเร็จ: ปลด Emergency Stop ขณะหยุดก่อน Start" }, 400); }
}
