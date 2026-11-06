import { authed } from "@/lib/guard";
import { automationReadiness } from "@/lib/automation-readiness";
import { json } from "@/lib/http";
import { schemaReadiness } from "@/lib/schema-readiness";
export const dynamic = "force-dynamic";
export async function GET() {
  const { error } = await authed(); if (error) return error;
  try {
    const schema = await schemaReadiness();
    if (!schema.ready) return json({ error: "โครงสร้างฐานข้อมูลยังไม่ครบ ต้องรัน migration บนสภาพแวดล้อมเซิร์ฟเวอร์ก่อนใช้งาน", code: "SCHEMA_NOT_READY", schema }, 503);
    const response = json(await automationReadiness()); response.headers.set("Cache-Control", "no-store"); return response;
  }
  catch { return json({ error: "ตรวจความพร้อมไม่สำเร็จ ตรวจฐานข้อมูลและ migration" }, 503); }
}
