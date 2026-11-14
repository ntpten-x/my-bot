import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { authMutationError } from "@/lib/auth-request";
import { authRateError, requestIdentity } from "@/lib/auth-rate";
import { authenticateOwner } from "@/lib/passport-auth";
import { verifySecondFactor } from "@/lib/mfa";
import { checkLogin, recordLogin } from "@/lib/login-guard";
import { dbGuardStore } from "@/lib/login-guard-db";
import { readJson } from "@/lib/request-body";
import { acquireLoginSlot } from "@/lib/auth-capacity";
import { appendSecurityAudit } from "@/lib/security-audit";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const csrf = authMutationError(request); if (csrf) return csrf;
  const rate = authRateError(request); if (rate) return rate;
  const { session, error } = await authed({ allowMfaSetup: true }); if (error) return error;
  const key = `step-up:${requestIdentity(request)}`;
  if (await checkLogin(dbGuardStore, key) > 0) return json({ error: "ลองรหัสบ่อยเกินไป กรุณารอ" }, 429);
  const body = z.object({ password: z.string().min(1).max(200), code: z.string().trim().max(64).optional() }).strict().safeParse(await readJson(request, 16_384).catch(() => null));
  if (!body.success) return json({ error: "กรอกข้อมูลยืนยันตัวตน" }, 400);
  const release = acquireLoginSlot(); if (!release) return json({ error: "ระบบกำลังตรวจบัญชี กรุณาลองใหม่" }, 429);
  try {
    const identity = await prisma.owner.findUniqueOrThrow({ where: { id: session!.ownerId }, select: { username: true } });
    const owner = await authenticateOwner(identity.username, body.data.password);
    const proof = owner?.mfaSecret ? await verifySecondFactor(owner.id, body.data.code || "") : undefined;
    if (!owner || (owner.mfaSecret && !proof)) {
      await recordLogin(dbGuardStore, key, false); return json({ error: "ข้อมูลยืนยันตัวตนไม่ถูกต้อง" }, 401);
    }
    const changed = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Owner" WHERE id=${owner.id} FOR UPDATE`;
      const current = await tx.owner.findUniqueOrThrow({ where: { id: owner.id } });
      if (current.authVersion !== owner.authVersion) return 0;
      const result = await tx.session.updateMany({ where: { id: session!.id, authVersion: owner.authVersion }, data: { authenticatedAt: new Date(), ...(proof ? { mfaVerifiedAt: proof.mfaVerifiedAt } : {}) } });
      if (result.count) await appendSecurityAudit("auth.step_up", owner.id, "success", tx);
      return result.count;
    });
    if (!changed) return json({ error: "เซสชันเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่" }, 401);
    await recordLogin(dbGuardStore, key, true); return json({ ok: true, validForSeconds: 300 });
  } finally { release(); }
}
