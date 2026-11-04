import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// API keys are stored AES-256-GCM encrypted. The key comes from AI_KEY_SECRET in .env,
// so a database dump alone cannot reveal provider keys.
function masterKey(): Buffer {
  const secret = process.env.AI_KEY_SECRET?.trim();
  if (!secret || secret.length < 16) throw new Error("ยังไม่ได้ตั้ง AI_KEY_SECRET ใน .env (อย่างน้อย 16 ตัวอักษร)");
  return createHash("sha256").update(secret).digest();
}

export function hasKeySecret() {
  const secret = process.env.AI_KEY_SECRET?.trim();
  return Boolean(secret && secret.length >= 16);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  const [version, iv, tag, body] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("รูปแบบคีย์ที่เก็บไว้ไม่ถูกต้อง");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

/** A short hint the browser may see, e.g. "gsk…9xQ2". Never the full key. */
export function maskSecret(plain: string): string {
  if (!plain) return "";
  if (plain.length <= 10) return "••••";
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}