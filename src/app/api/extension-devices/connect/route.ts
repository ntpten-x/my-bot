import { readJson } from "@/lib/request-body";
import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { registerExtensionHash } from "@/lib/extension-devices";
import { selfOriginOf, transportAllowed } from "@/lib/request-security";
import { clientIp } from "@/lib/auth";

export const dynamic = "force-dynamic";
const input = z.object({ tokenHash: z.string().regex(/^[a-f0-9]{64}$/), tokenHint: z.string().regex(/^mbd_…[A-Za-z0-9_-]{4}$/), name: z.string().trim().min(1).max(60) }).strict();

export async function POST(request: Request) {
  if (!transportAllowed(request.headers, request.url) || request.headers.get("origin") !== selfOriginOf(request.headers, request.url)) return json({ error: "ต้องเชื่อมต่อจากหน้า MY-BOT นี้เท่านั้น" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, 415);
  const { error } = await authed();
  if (error) return error;
  if (Number(request.headers.get("content-length")) > 2048) return json({ error: "คำขอใหญ่เกินกำหนด" }, 413);
  const parsed = input.safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลอุปกรณ์ไม่ถูกต้อง" }, 400);
  try {
    const result = await registerExtensionHash(parsed.data.tokenHash, parsed.data.tokenHint, parsed.data.name, clientIp(request.headers.get("x-forwarded-for")));
    if (!result) return json({ error: "อุปกรณ์นี้ถูกยกเลิกแล้ว กรุณาตรวจรายการอุปกรณ์บน MY-BOT" }, 403);
    const response = json({ ok: true, ...result });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return json({ error: "เชื่อมต่ออุปกรณ์ไม่สำเร็จ ลองใหม่อีกครั้ง" }, 503); }
}
