import { z } from "zod";
import { clientIp } from "@/lib/auth";
import { json } from "@/lib/http";
import { redeemPairingCode } from "@/lib/extension-devices";
import { checkLogin, recordLogin } from "@/lib/login-guard";
import { dbGuardStore } from "@/lib/login-guard-db";
import { transportAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().min(4).max(20), name: z.string().max(60).optional() });

/** The extension trades a one-time pairing code (shown on the web page) for its own device token. */
export async function POST(request: Request) {
  if (!transportAllowed(request.headers, request.url)) return json({ error: "ต้องเชื่อมต่อผ่าน HTTPS" }, 403);
  const ip = clientIp(request.headers.get("x-forwarded-for"));
  if ((await checkLogin(dbGuardStore, `pair:${ip}`)) > 0) return json({ error: "ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่" }, 429);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ใส่รหัสจับคู่ 8 ตัว" }, 400);
  const result = await redeemPairingCode(parsed.data.code, parsed.data.name ?? "Chrome", ip);
  await recordLogin(dbGuardStore, `pair:${ip}`, Boolean(result));
  if (!result) return json({ error: "รหัสจับคู่ไม่ถูกต้อง หมดอายุ หรือใช้ไปแล้ว" }, 401);
  return json({ ok: true, token: result.token, deviceId: result.deviceId });
}