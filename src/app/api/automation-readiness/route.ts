import { authed } from "@/lib/guard";
import { automationReadiness } from "@/lib/automation-readiness";
import { json } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  const { error } = await authed(); if (error) return error;
  try { const response = json(await automationReadiness()); response.headers.set("Cache-Control", "no-store"); return response; }
  catch { return json({ error: "ตรวจความพร้อมไม่สำเร็จ ตรวจฐานข้อมูลและ migration" }, 503); }
}
