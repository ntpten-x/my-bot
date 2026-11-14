import { exportSecurityAudit } from "./audit-export";
import { serverSecret } from "./server-secret";
import { mkdir, readdir, stat, unlink, appendFile, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import { backupCipher } from "./backup-crypto";
import { uploadBackup } from "./backup-upload";
import { writeBackupJson } from "./backup-stream";
import { createGzip, gzipSync } from "node:zlib";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { snapshotDatabase } from "./backup-format";
export { BACKUP_TABLES } from "./backup-format";
import { prisma } from "./prisma";
import { upsertSettings } from "./settings";
import { bangkokClock } from "./smart/summary";
import { shouldSendSummary } from "./smart/summary";

export function backupsToDelete(files: { name: string; mtimeMs: number }[], now: number, keepDays = 14) {
  const cutoff = now - keepDays * 24 * 3600 * 1000;
  return files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.(db|json\.gz)$/.test(file.name) && file.mtimeMs < cutoff)
    .map((file) => file.name);
}

/** Snapshot of all rows as gzip JSON. Restore with `npm run db:restore -- <file> --replace`. */
export async function exportDatabase() {
  return gzipSync(JSON.stringify(await snapshotDatabase(prisma)));
}

export async function backupDatabase(name?: string) {
  if (process.env.RENDER && !process.env.BACKUP_UPLOAD_URL) throw new Error("Cloud backup requires an off-host destination; configure BACKUP_UPLOAD_URL");
  const day = bangkokClock().day;
  const directory = path.resolve("data", "backups");
  await mkdir(directory, { recursive: true });
  const file = name ?? `${day}.json.gz`;
  if (path.basename(file) !== file) throw new Error("Invalid backup filename");
  const target = path.join(directory, file);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const secret = serverSecret("BACKUP_ENCRYPTION_KEY") || serverSecret("AI_KEY_SECRET");
  if (secret.length < 16) throw new Error("All backups require an encryption key");
  const output = createWriteStream(temporary, { mode: 0o600, flags: "wx" });
  const gzip = createGzip();
  const encryption = secret.length >= 16 ? backupCipher(secret) : null;
  if (encryption) output.write(encryption.header);
  const writing = encryption ? pipeline(gzip, encryption.cipher, output) : pipeline(gzip, output);
  // Attach immediately so early stream errors cannot become unhandled rejections.
  void writing.catch(() => undefined);
  try {
    await writeBackupJson(prisma, async chunk => { if (!gzip.write(chunk)) await once(gzip, "drain"); });
    gzip.end(); await writing;
    if (encryption) await appendFile(temporary, encryption.cipher.getAuthTag());
    await rename(temporary, target);
  } catch (error) { gzip.destroy(); output.destroy(); await writing.catch(() => undefined); await unlink(temporary).catch(() => undefined); throw error; }
  const remote = await uploadBackup(target, file);
  await exportSecurityAudit(prisma, directory, file);
  const entries = await readdir(directory);
  const files = await Promise.all(
    entries.map(async (entry) => ({ name: entry, mtimeMs: (await stat(path.join(directory, entry))).mtimeMs })),
  );
  for (const old of backupsToDelete(files, Date.now())) {
    await unlink(path.join(directory, old)).catch(() => undefined);
  }
  await upsertSettings({
    backup_last_at: new Date().toISOString(),
    backup_last_file: `data/backups/${file}`,
    backup_storage: remote ? "remote" : "local",
    ...(remote ? { backup_remote_key: remote.objectKey, backup_remote_sha256: remote.sha256 } : {}),
  });
  return `data/backups/${file}`;
}

export async function maybeBackupDatabase() {
  const clock = bangkokClock();
  const last = await prisma.setting.findUnique({ where: { key: "backup_last_day" } });
  if (!shouldSendSummary(clock.time, "03:00", last?.value ?? null, clock.day)) return;
  try {
    await backupDatabase();
    await upsertSettings({ backup_last_day: clock.day });
  } catch {
    console.error("[backup] Backup failed; check storage configuration and connectivity");
    await upsertSettings({ backup_last_error_at: new Date().toISOString() }).catch(() => undefined);
  }
}