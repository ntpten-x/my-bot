import { previousSecrets, serverSecret } from "./server-secret";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type AuditEvent = "login.success" | "login.failed" | "mfa.enabled" | "mfa.disabled" | "mfa.recovery_rotated" | "auth.step_up" | "password.changed" | "password.reset" | "sessions.cutover" | "backup.restore" | "config.changed" | "comment.control" | "session.revoked";
const genesis = "0".repeat(64);
function signature(value: string, key = serverSecret("SECURITY_AUDIT_KEY") || serverSecret("AI_KEY_SECRET")) {
  if (key.length < 16) throw new Error("Security audit key unavailable");
  return createHmac("sha256", key).update("mybot-security-audit-v1\0" + value).digest("hex");
}
function canonical(row: { sequence: bigint; at: Date; event: string; actorId: string | null; outcome: string; previousHash: string }) {
  return JSON.stringify([String(row.sequence), row.at.toISOString(), row.event, row.actorId, row.outcome, row.previousHash]);
}
export async function appendSecurityAudit(event: AuditEvent, actorId: string | null, outcome = "success", tx?: Prisma.TransactionClient): Promise<void> {
  if (!tx) return prisma.$transaction(db => appendSecurityAudit(event, actorId, outcome, db));
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(71024, 3)`;
  const head = await tx.securityAuditHead.findUnique({ where: { id: "global" } });
  const row = { sequence: (head?.sequence ?? BigInt(0)) + BigInt(1), at: new Date(), event, actorId, outcome, previousHash: head?.hash ?? genesis };
  const hash = signature(canonical(row));
  await tx.securityAudit.create({ data: { ...row, hash } });
  await tx.securityAuditHead.upsert({ where: { id: "global" }, create: { id: "global", sequence: row.sequence, hash }, update: { sequence: row.sequence, hash } });
}
export async function verifySecurityAudit() {
  return prisma.$transaction(async tx => {
  let sequence = BigInt(0), hash = genesis;
  for (;;) {
    const rows = await tx.securityAudit.findMany({ where: { sequence: { gt: sequence } }, orderBy: { sequence: "asc" }, take: 200 });
    if (!rows.length) break;
    for (const row of rows) {
      const validSignature = [undefined, ...previousSecrets("SECURITY_AUDIT_PREVIOUS_KEYS")].some(key => { const expected = signature(canonical(row), key); return row.hash.length === expected.length && timingSafeEqual(Buffer.from(row.hash), Buffer.from(expected)); });
      if (row.sequence !== sequence + BigInt(1) || row.previousHash !== hash || !validSignature) return { valid: false, checked: String(sequence) };
      sequence = row.sequence; hash = row.hash;
    }
  }
  const head = await tx.securityAuditHead.findUnique({ where: { id: "global" } });
  return { valid: sequence === (head?.sequence ?? BigInt(0)) && hash === (head?.hash ?? genesis), checked: String(sequence), checkpoint: hash };
  }, { isolationLevel: "RepeatableRead", timeout: 60_000 });
}
