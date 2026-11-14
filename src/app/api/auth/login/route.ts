import { mfaRequiredForAccess } from "@/lib/session-policy";
import { authRateError, requestIdentity } from "@/lib/auth-rate";
import { verifySecondFactor } from "@/lib/mfa";
import { appendSecurityAudit } from "@/lib/security-audit";
import { acquireLoginSlot } from "@/lib/auth-capacity";
import { readJson } from "@/lib/request-body";
import { authenticateOwner } from "@/lib/passport-auth";
import { z } from "zod";
import { cookieOptions, createSession, ownerExists, SESSION_COOKIE } from "@/lib/auth";
import { json } from "@/lib/http";
import { checkLogin, recordLogin } from "@/lib/login-guard";
import { dbGuardStore } from "@/lib/login-guard-db";
import { isWeakPassword } from "@/lib/password-policy";
import { setPasswordWeak } from "@/lib/password-flag";
import { authMutationError } from "@/lib/auth-request";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200), code: z.string().trim().max(64).optional() });

function locked(waitMs: number) {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  const response = json({ error: `ใส่รหัสผิดหลายครั้ง ล็อกไว้ชั่วคราว ลองใหม่ในอีก ${minutes} นาที` }, 429);
  response.headers.set("Retry-After", String(Math.ceil(waitMs / 1000)));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  const mutationError = authMutationError(request); if (mutationError) return mutationError;
  const rateError = authRateError(request); if (rateError) return rateError;
  if (!(await ownerExists())) return json({ error: "ยังไม่ได้ตั้งรหัสผ่าน", needsSetup: true }, 409);
  const ip = requestIdentity(request);
  const wait = await checkLogin(dbGuardStore, ip);
  if (wait > 0) return locked(wait);
  const parsed = bodySchema.safeParse(await readJson(request, 16_384).catch(() => null));
  if (!parsed.success) return json({ error: "กรอกชื่อผู้ใช้และรหัสผ่าน" }, 400);
  const release = acquireLoginSlot();
  if (!release) {
    const response = json({ error: "ระบบกำลังตรวจบัญชีหลายรายการ กรุณาลองใหม่" }, 429);
    response.headers.set("Retry-After", "1"); return response;
  }
  try {
    const owner = await authenticateOwner(parsed.data.username, parsed.data.password);
    if (!owner) {
      await recordLogin(dbGuardStore, ip, false);
      await appendSecurityAudit("login.failed", null, "rejected");
      const after = await checkLogin(dbGuardStore, ip);
      return after > 0 ? locked(after) : json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, 401);
    }
    if (owner.mfaSecret && !parsed.data.code) return json({ error: "กรอกรหัส Authenticator หรือ recovery code", mfaRequired: true }, 401);
    const proof = owner.mfaSecret ? await verifySecondFactor(owner.id, parsed.data.code!) : undefined;
    if (owner.mfaSecret && !proof) {
      await recordLogin(dbGuardStore, ip, false);
      await appendSecurityAudit("login.failed", owner.id, "second_factor_rejected");
      return json({ error: "รหัสยืนยันไม่ถูกต้องหรือใช้ไปแล้ว", mfaRequired: true }, 401);
    }
    await recordLogin(dbGuardStore, ip, true);
    const weak = isWeakPassword(parsed.data.password);
    await setPasswordWeak(weak);
    const token = await createSession(owner.id, owner.passwordHash, proof ?? undefined);
    const response = json({ ok: true, weakPassword: weak, mfaSetupRequired: mfaRequiredForAccess() && !owner.mfaSecret });
    response.cookies.set(SESSION_COOKIE, token, cookieOptions(request));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally { release(); }
}
