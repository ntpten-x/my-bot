import { serverSecret } from "./server-secret";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { SESSION_ABSOLUTE_MS, sessionIsActive } from "./session-policy";
import { appendSecurityAudit } from "./security-audit";
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { SESSION_COOKIE } from "./auth-cookie";
import { isHttpsRequest, isLocalRequest, transportAllowed } from "./request-security";
import { verifyDeviceToken } from "./extension-devices";

export { SESSION_COOKIE };
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; reset: number }>();
/** Secure is on whenever the request arrived over HTTPS (e.g. Render); plain http://localhost keeps working. */
export function cookieOptions(request?: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: request ? isHttpsRequest(request.headers, request.url) : false,
    maxAge: SESSION_ABSOLUTE_MS / 1000,
  };
}

export function allowLogin(ip: string) {
  const now = Date.now();
  const row = attempts.get(ip);
  if (!row || row.reset < now) {
    attempts.set(ip, { count: 1, reset: now + WINDOW_MS });
    return true;
  }
  row.count += 1;
  return row.count <= 8;
}

export async function ownerExists() {
  return (await prisma.owner.count()) > 0;
}

export async function createOwner(password: string, username = "admin") {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(71024, 1)`;
    if (await tx.owner.count()) throw new Error("ตั้งรหัสผ่านไปแล้ว");
    return tx.owner.create({ data: { passwordHash, username } });
  });
}

/** Store only a digest of new random session credentials; old sessions remain readable. */
export function sessionDigest(token: string) {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}
function sessionSignature(value: string) {
  const key = serverSecret("SESSION_SIGNING_KEY") || serverSecret("AI_KEY_SECRET");
  if (key.length < 16) throw new Error("Session signing key unavailable");
  return createHmac("sha256", key).update(`mybot-session-v1:${value}`).digest("hex");
}
export function validSessionToken(token: string) {
  if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) return process.env.AUTH_ALLOW_LEGACY_SESSIONS === "1" && /^[a-f0-9]{64}$/.test(token);
  const [value, signature] = token.split(".");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(sessionSignature(value)));
}
export async function createSession(ownerId: string, expectedHash?: string, proof?: { version: number; mfaVerifiedAt: Date }) {
  const value = randomBytes(32).toString("hex");
  const token = `${value}.${sessionSignature(value)}`;
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Owner" WHERE id=${ownerId} FOR UPDATE`;
    const owner = await tx.owner.findUnique({ where: { id: ownerId } });
    if (!owner || (expectedHash && owner.passwordHash !== expectedHash)) throw new Error("Credentials changed during login");
    if (owner.mfaSecret && (!proof || proof.version !== owner.authVersion)) throw new Error("Second factor required");
    await tx.session.create({ data: { ownerId, token: sessionDigest(token), expiresAt, authVersion: owner.authVersion, mfaVerifiedAt: proof?.mfaVerifiedAt ?? null } });
    await appendSecurityAudit("login.success", ownerId, "success", tx);
  });
  return token;
}

export async function verifyPassword(password: string) {
  const owner = await prisma.owner.findFirst();
  if (!owner) return null;
  const ok = await bcrypt.compare(password, owner.passwordHash);
  return ok ? owner : null;
}

export const getSession = cache(async function getSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  if (!validSessionToken(token)) return null;
  const include = { owner: { select: { authVersion: true, mfaSecret: true } } } as const;
  const found = await prisma.session.findUnique({ where: { token: sessionDigest(token) }, include })
    ?? (process.env.AUTH_ALLOW_LEGACY_SESSIONS === "1" ? await prisma.session.findUnique({ where: { token }, include }) : null);
  if (!found) return null;
  const { owner, ...session } = found;
  if (!sessionIsActive(session, owner)) return null;
  return { ...session, mfaEnabled: Boolean(owner.mfaSecret) };
});

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && validSessionToken(token)) {
    await prisma.session.deleteMany({ where: { token: { in: [token, sessionDigest(token)] } } });
  }
}

/**
 * Extension auth. Paired device tokens work over HTTPS (or locally). The older shared settings token
 * is accepted only from the local app, so a public deployment needs a paired device.
 */
export async function requireExtensionToken(header: string | null, request?: Request) {
  const token = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (request && !transportAllowed(request.headers, request.url)) return false;
  if (token.startsWith("mbd_")) {
    const ip = request ? clientIp(request.headers.get("x-forwarded-for")) : "";
    return Boolean(await verifyDeviceToken(token, { ip }));
  }
  if (process.env.AUTH_ALLOW_LEGACY_EXTENSION_TOKEN !== "1" || (request && !isLocalRequest(request.headers, request.url))) return false;
  const settings = await getSettings();
  const expected = settings.extensionToken;
  if (!token || !expected) return false;
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function clientIp(header: string | null) {
  return header?.split(",")[0]?.trim() || "local";
}
