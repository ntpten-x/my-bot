import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
export const BACKUP_MAGIC = Buffer.from("MYBOTB1");
function key(secret: string) { return createHash("sha256").update("mybot-backup-v1\0" + secret).digest(); }
export function backupCipher(secret: string) {
  if (secret.length < 16) throw new Error("Backup encryption key is required");
  const iv = randomBytes(12);
  return { cipher: createCipheriv("aes-256-gcm", key(secret), iv), header: Buffer.concat([BACKUP_MAGIC, iv]) };
}
export function decodeBackup(raw: Buffer, secret = process.env.BACKUP_ENCRYPTION_KEY || process.env.AI_KEY_SECRET || "") {
  let body = raw;
  if (raw.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    if (secret.length < 16) throw new Error("Backup encryption key is required");
    const start = BACKUP_MAGIC.length;
    const decipher = createDecipheriv("aes-256-gcm", key(secret), raw.subarray(start, start + 12));
    decipher.setAuthTag(raw.subarray(-16));
    body = Buffer.concat([decipher.update(raw.subarray(start + 12, -16)), decipher.final()]);
  }
  return body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body) : body;
}
