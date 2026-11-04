import { randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { SESSION_COOKIE } from "./auth-cookie";

export { SESSION_COOKIE };
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; reset: number }>();
// Every API call checks the session; the DB is ~170 ms away, so keep a verified session for a minute.
const SESSION_CACHE_MS = 60_000;
const sessionCache = new Map<string, { until: number; session: { id: string; ownerId: string; token: string; expiresAt: Date; createdAt: Date } }>();

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: false,
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
  if (await ownerExists()) throw new Error("ตั้งรหัสผ่านไปแล้ว");
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.owner.create({ data: { passwordHash } });
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
  const cached = sessionCache.get(token);
  if (cached && cached.until > Date.now() && cached.session.expiresAt.getTime() >= Date.now()) return cached.session;
  sessionCache.delete(token);
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session) return null;
  if (session.expiresAt.getTime() >= Date.now()) {
    if (sessionCache.size > 200) sessionCache.clear();
    sessionCache.set(token, { until: Date.now() + SESSION_CACHE_MS, session });
  }
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
    sessionCache.delete(token);
    await prisma.session.deleteMany({ where: { token } });
  }
}

export async function requireExtensionToken(header: string | null) {
  const token = (header ?? "").replace(/^Bearer\s+/i, "").trim();
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
