// Per-device extension tokens issued through a short one-time pairing code.
// Only SHA-256 hashes are stored; the plain token is shown to the extension once.
import { createHash, randomBytes, randomInt } from "crypto";
import { prisma } from "./prisma";

export const PAIRING_TTL_MS = 10 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function newPairingCode() {
  let raw = "";
  for (let i = 0; i < 8; i += 1) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizeCode(input: string) {
  const raw = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : "";
}

export function newDeviceToken() {
  return `mbd_${randomBytes(32).toString("base64url")}`;
}

export function tokenHint(token: string) {
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export async function createPairingCode(now = new Date()) {
  await prisma.extensionPairingCode.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } });
  const code = newPairingCode();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  await prisma.extensionPairingCode.create({ data: { codeHash: sha256(code), expiresAt } });
  return { code, expiresAt };
}

/** One-time: marks the code used atomically, then issues a device token. */
export async function redeemPairingCode(input: string, name: string, ip: string, now = new Date()) {
  const code = normalizeCode(input);
  if (!code) return null;
  const claimed = await prisma.extensionPairingCode.updateMany({
    where: { codeHash: sha256(code), usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return null;
  const token = newDeviceToken();
  const device = await prisma.extensionDevice.create({
    data: { name: String(name || "Chrome").slice(0, 60), tokenHash: sha256(token), tokenHint: tokenHint(token), lastIp: ip.slice(0, 60) },
  });
  return { token, deviceId: device.id };
}

const cache = new Map<string, { until: number; id: string | null }>();
const touched = new Map<string, number>();

export function clearDeviceCache() {
  cache.clear();
}

export async function verifyDeviceToken(token: string, meta: { ip?: string; version?: string } = {}) {
  if (!token.startsWith("mbd_")) return null;
  const hash = sha256(token);
  const hit = cache.get(hash);
  let id: string | null;
  if (hit && hit.until > Date.now()) id = hit.id;
  else {
    const row = await prisma.extensionDevice.findUnique({ where: { tokenHash: hash }, select: { id: true, revokedAt: true } });
    id = row && !row.revokedAt ? row.id : null;
    if (cache.size > 500) cache.clear();
    cache.set(hash, { until: Date.now() + 30_000, id });
  }
  if (id && (touched.get(id) ?? 0) < Date.now() - 60_000) {
    touched.set(id, Date.now());
    await prisma.extensionDevice
      .update({ where: { id }, data: { lastSeenAt: new Date(), ...(meta.ip ? { lastIp: meta.ip.slice(0, 60) } : {}), ...(meta.version ? { version: meta.version.slice(0, 20) } : {}) } })
      .catch(() => undefined);
  }
  return id;
}

export async function listDevices() {
  const rows = await prisma.extensionDevice.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tokenHint: row.tokenHint,
    version: row.version,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }));
}

export async function revokeDevice(id: string) {
  const result = await prisma.extensionDevice.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  cache.clear();
  return result.count > 0;
}