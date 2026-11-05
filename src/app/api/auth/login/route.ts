import { z } from "zod";
import { clientIp, cookieOptions, createSession, ownerExists, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { json } from "@/lib/http";
import { checkLogin, recordLogin } from "@/lib/login-guard";
import { dbGuardStore } from "@/lib/login-guard-db";
import { isWeakPassword } from "@/lib/password-policy";
import { setPasswordWeak } from "@/lib/password-flag";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ password: z.string().min(1).max(200) });

function locked(waitMs: number) {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  const response = json({ error: `ใส่รหัสผิดหลายครั้ง ล็อกไว้ชั่วคราว ลองใหม่ในอีก ${minutes} นาที` }, 429);
  response.headers.set("Retry-After", String(Math.ceil(waitMs / 1000)));
  return response;
}

export async function POST(request: Request) {
  if (!(await ownerExists())) return json({ error: "ยังไม่ได้ตั้งรหัสผ่าน", needsSetup: true }, 409);
  const ip = clientIp(request.headers.get("x-forwarded-for"));
  const wait = await checkLogin(dbGuardStore, ip);
  if (wait > 0) return locked(wait);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "กรอกรหัสผ่าน" }, 400);
  const owner = await verifyPassword(parsed.data.password);
  await recordLogin(dbGuardStore, ip, Boolean(owner));
  if (!owner) {
    const after = await checkLogin(dbGuardStore, ip);
    return after > 0 ? locked(after) : json({ error: "รหัสผ่านไม่ถูกต้อง" }, 401);
  }
  const weak = isWeakPassword(parsed.data.password);
  await setPasswordWeak(weak);
  const token = await createSession(owner.id);
  const response = json({ ok: true, weakPassword: weak });
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(request));
  return response;
}