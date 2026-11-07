import { randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
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
    maxAge: 60 * 60 * 24 * 30,
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

export async function createOwner(password: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(71024, 1)`;
    if (await tx.owner.count()) throw new Error("ตั้งรหัสผ่านไปแล้ว");
    return tx.owner.create({ data: { passwordHash } });
  });
}

export async function createSession(ownerId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await prisma.session.create({ data: { ownerId, token, expiresAt } });
  return token;
}

export async function verifyPassword(password: string) {
  const owner = await prisma.owner.findFirst();
  if (!owner) return null;
  const ok = await bcrypt.compare(password, owner.passwordHash);
  return ok ? owner : null;
}

export async function getSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
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
  if (request && !isLocalRequest(request.headers, request.url)) return false;
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
