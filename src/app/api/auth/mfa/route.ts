import { mfaRequiredForAccess } from "@/lib/session-policy";
import { z } from "zod";
import QRCode from "qrcode";
import { authed } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { json } from "@/lib/http";
import { authMutationError } from "@/lib/auth-request";
import { authRateError, requestIdentity } from "@/lib/auth-rate";
import { readJson } from "@/lib/request-body";
import { beginMfa, changeMfa } from "@/lib/mfa";
import { checkLogin, recordLogin } from "@/lib/login-guard";
import { dbGuardStore } from "@/lib/login-guard-db";
export const dynamic = "force-dynamic";
export async function GET() {
  const { session, error } = await authed({ allowMfaSetup: true }); if (error) return error;
  const owner = await prisma.owner.findUniqueOrThrow({ where: { id: session!.ownerId }, select: { mfaSecret: true } });
  const recoveryCodesLeft = await prisma.recoveryCode.count({ where: { ownerId: session!.ownerId, consumedAt: null } });
  return json({ required: mfaRequiredForAccess(), available: process.env.SECURITY_RELEASE_READY === "1", enabled: Boolean(owner.mfaSecret), recoveryCodesLeft, idleMinutes: 30, absoluteHours: 8, recentAuthMinutes: 5 });
}
export async function POST(request: Request) {
  const csrf = authMutationError(request); if (csrf) return csrf;
  const rate = authRateError(request); if (rate) return rate;
  const { session, error } = await authed({ recent: true, allowMfaSetup: true }); if (error) return error;
  const key = `mfa:${requestIdentity(request)}`;
  if (await checkLogin(dbGuardStore, key) > 0) return json({ error: "ลองรหัสบ่อยเกินไป กรุณารอ" }, 429);
  const input = z.object({ action: z.enum(["begin", "confirm", "disable", "rotate"]), code: z.string().trim().max(64).optional() }).strict().safeParse(await readJson(request, 16_384).catch(() => null));
  if (!input.success) return json({ error: "คำสั่งไม่ถูกต้อง" }, 400);
  try {
    if (["begin", "confirm"].includes(input.data.action) && process.env.SECURITY_RELEASE_READY !== "1") return json({ error: "ต้องอัปเดตทุกเว็บของระบบก่อนเปิด MFA" }, 503);
    if (input.data.action === "begin") {
      const enrollment = await beginMfa(session!.ownerId);
      return json({ secret: enrollment.secret, qr: await QRCode.toDataURL(enrollment.uri, { width: 240, margin: 1 }) });
    }
    const result = await changeMfa(session!.ownerId, session!.id, input.data.action, input.data.code || "");
    await recordLogin(dbGuardStore, key, true);
    return json(result);
  } catch {
    await recordLogin(dbGuardStore, key, false);
    return json({ error: "รหัสไม่ถูกต้อง ใช้ไปแล้ว หรือการตั้งค่าหมดอายุ กรุณาตรวจรหัสรอบใหม่" }, 400);
  }
}
