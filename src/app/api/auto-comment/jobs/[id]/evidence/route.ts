import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { readCommentEvidence } from "@/lib/auto-comment/evidence";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed(); if (error) return error;
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return json({ error: "รหัสงานไม่ถูกต้อง" }, 400);
  try {
    const evidence = await readCommentEvidence(id);
    const response = evidence ? json(evidence) : json({ error: "ไม่พบงานคอมเมนต์" }, 404);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch { return json({ error: "โหลดหลักฐานไม่สำเร็จ กรุณาตรวจฐานข้อมูล" }, 503); }
}
