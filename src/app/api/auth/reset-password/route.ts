import { verifySecondFactor } from "@/lib/mfa";
import { appendSecurityAudit } from "@/lib/security-audit";
import { authRateError } from "@/lib/auth-rate";
import { readJson } from "@/lib/request-body";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { clientIp, cookieOptions, createSession, ownerExists, SESSION_COOKIE } from "@/lib/auth";
import { bootstrapTokenErrorMessage, bootstrapTokenOk } from "@/lib/bootstrap-token";
import { json } from "@/lib/http";
import { checkLogin, recordLogin } from "@/lib/login-guard";
import { dbGuardStore } from "@/lib/login-guard-db";
import { setPasswordWeak } from "@/lib/password-flag";
import { passwordProblems } from "@/lib/password-policy";
import { prisma } from "@/lib/prisma";
import { authMutationError } from "@/lib/auth-request";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  code: z.string().trim().max(64).optional(),
  bootstrapToken: z.string().max(256).optional(),
  password: z.string().max(200).min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัว"),
  confirm: z.string().max(200),
});

function locked(waitMs: number) {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  const response = json({ error: `ใส่รหัสผิดหลายครั้ง ล็อกไว้ชั่วคราว ลองใหม่ในอีก ${minutes} นาที` }, 429);
  response.headers.set("Retry-After", String(Math.ceil(waitMs / 1000)));
  return response;
}

export async function POST(request: Request) {
  const mutationError = authMutationError(request); if (mutationError) return mutationError;
  const rateError = authRateError(request); if (rateError) return rateError;
  if (!(await ownerExists())) return json({ error: "ยังไม่ได้ตั้งรหัสผ่าน", needsSetup: true }, 409);
  const ip = clientIp(request.headers.get("x-forwarded-for"));
  const wait = await checkLogin(dbGuardStore, ip);
  if (wait > 0) return locked(wait);

  const parsed = bodySchema.safeParse(await readJson(request, 16_384).catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "กรอกข้อมูลให้ครบ" }, 400);
  if (parsed.data.password !== parsed.data.confirm) return json({ error: "รหัสผ่านไม่ตรงกัน" }, 400);
  const problems = passwordProblems(parsed.data.password);
  if (problems.length) return json({ error: `รหัสผ่านยังไม่ปลอดภัย: ต้อง${problems.join(", ")}`, problems }, 400);

  const tokenOk = bootstrapTokenOk(request, parsed.data.bootstrapToken);
  await recordLogin(dbGuardStore, ip, tokenOk);
  if (!tokenOk) {
    const after = await checkLogin(dbGuardStore, ip);
    return after > 0 ? locked(after) : json({ error: bootstrapTokenErrorMessage() }, 403);
  }

  const owner = await prisma.owner.findFirst();
  if (!owner) return json({ error: "ยังไม่ได้ตั้งรหัสผ่าน", needsSetup: true }, 409);

  const proof = owner.mfaSecret ? await verifySecondFactor(owner.id, parsed.data.code || "") : undefined;
  if (owner.mfaSecret && !proof) return json({ error: "ต้องใช้ Authenticator หรือ recovery code", mfaRequired: true }, 401);
  const hash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Owner" WHERE id=${owner.id} FOR UPDATE`;
    const current = await tx.owner.findUniqueOrThrow({ where: { id: owner.id } });
    if (current.authVersion !== owner.authVersion) throw new Error("Credentials changed during recovery");
    await tx.owner.update({ where: { id: owner.id }, data: { passwordHash: hash, authVersion: { increment: 1 } } });
    await appendSecurityAudit("password.reset", owner.id, "success", tx);
    await tx.session.deleteMany({ where: { ownerId: owner.id } });
  });
  await setPasswordWeak(false);

  const sessionToken = await createSession(owner.id, hash, proof ? { ...proof, version: owner.authVersion + 1 } : undefined);
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken, cookieOptions(request));
  return response;
}
