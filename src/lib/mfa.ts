import { createHash, randomBytes } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import type { Owner, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { encryptSecret, decryptSecret } from "./ai/secret-box";
import { appendSecurityAudit } from "./security-audit";

export function ownerTotp(secret: string, username: string) {
  return new TOTP({ issuer: "MY-BOT", label: username, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}
export function recoveryHash(ownerId: string, code: string) {
  return createHash("sha256").update(`mybot-recovery-v1:${ownerId}:${code.replaceAll("-", "").toUpperCase()}`).digest("hex");
}
export async function consumeSecondFactor(tx: Prisma.TransactionClient, owner: Owner, code: string, now = Date.now()) {
  if (!owner.mfaSecret) return false;
  if (/^\d{6}$/.test(code)) {
    const delta = ownerTotp(decryptSecret(owner.mfaSecret), owner.username).validate({ token: code, window: 1, timestamp: now });
    if (delta === null) return false;
    const step = Math.floor(now / 30_000) + delta;
    if (step <= owner.mfaLastStep) return false;
    await tx.owner.update({ where: { id: owner.id }, data: { mfaLastStep: step } });
    return true;
  }
  if (!/^[A-Fa-f0-9-]{32,39}$/.test(code) || code.replaceAll("-", "").length !== 32) return false;
  return (await tx.recoveryCode.updateMany({ where: { ownerId: owner.id, codeHash: recoveryHash(owner.id, code), consumedAt: null }, data: { consumedAt: new Date(now) } })).count === 1;
}
export async function verifySecondFactor(ownerId: string, code: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Owner" WHERE id=${ownerId} FOR UPDATE`;
    const owner = await tx.owner.findUnique({ where: { id: ownerId } });
    if (!owner || !(await consumeSecondFactor(tx, owner, code))) return null;
    return { version: owner.authVersion, mfaVerifiedAt: new Date() };
  });
}
async function replaceRecoveryCodes(tx: Prisma.TransactionClient, ownerId: string) {
  const codes = Array.from({ length: 8 }, () => randomBytes(16).toString("hex").toUpperCase().match(/.{4}/g)!.join("-"));
  await tx.recoveryCode.deleteMany({ where: { ownerId } });
  await tx.recoveryCode.createMany({ data: codes.map(code => ({ ownerId, codeHash: recoveryHash(ownerId, code) })) });
  return codes;
}
export async function beginMfa(ownerId: string) {
  const secret = new Secret({ size: 20 }).base32;
  const owner = await prisma.owner.findUniqueOrThrow({ where: { id: ownerId } });
  if (owner.mfaSecret) throw new Error("MFA already active");
  const encrypted = encryptSecret(secret);
  const changed = await prisma.owner.updateMany({ where: { id: ownerId, mfaSecret: null }, data: { mfaPendingSecret: encrypted, mfaPendingExpiresAt: new Date(Date.now() + 10 * 60_000) } });
  if (!changed.count) throw new Error("MFA state changed");
  return { secret, uri: ownerTotp(secret, owner.username).toString() };
}
export async function changeMfa(ownerId: string, sessionId: string, action: "confirm" | "disable" | "rotate", code: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Owner" WHERE id=${ownerId} FOR UPDATE`;
    const owner = await tx.owner.findUniqueOrThrow({ where: { id: ownerId } });
    const session = await tx.session.findUnique({ where: { id: sessionId } });
    if (!session || session.ownerId !== ownerId || session.authVersion !== owner.authVersion || session.expiresAt.getTime() <= Date.now() || Date.now() - session.authenticatedAt.getTime() > 5 * 60_000) throw new Error("Recent authentication required");
    let secret = owner.mfaSecret;
    if (action === "confirm") {
      if (secret || !owner.mfaPendingSecret || !owner.mfaPendingExpiresAt || owner.mfaPendingExpiresAt.getTime() <= Date.now()) throw new Error("Enrollment expired");
      secret = owner.mfaPendingSecret;
    }
    if (!await consumeSecondFactor(tx, { ...owner, mfaSecret: secret, mfaLastStep: action === "confirm" ? -1 : owner.mfaLastStep }, code)) throw new Error("Invalid second factor");
    const version = owner.authVersion + 1;
    await tx.owner.update({ where: { id: ownerId }, data: { authVersion: version, mfaSecret: action === "disable" ? null : secret, mfaPendingSecret: null, mfaPendingExpiresAt: null } });
    await tx.session.deleteMany({ where: { ownerId, id: { not: sessionId } } });
    await tx.session.update({ where: { id: sessionId }, data: { authVersion: version, authenticatedAt: new Date(), mfaVerifiedAt: action === "disable" ? null : new Date() } });
    const recoveryCodes = action === "disable" ? [] : await replaceRecoveryCodes(tx, ownerId);
    if (action === "disable") await tx.recoveryCode.deleteMany({ where: { ownerId } });
    await appendSecurityAudit(action === "confirm" ? "mfa.enabled" : action === "disable" ? "mfa.disabled" : "mfa.recovery_rotated", ownerId, "success", tx);
    return { enabled: action !== "disable", recoveryCodes };
  });
}
