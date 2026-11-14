import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { appendFile, chmod, mkdir, rename, rm } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { PrismaClient } from "@prisma/client";
import { backupCipher } from "./backup-crypto";
import { serverSecret } from "./server-secret";
import { uploadBackup } from "./backup-upload";
/** Encrypted audit snapshot + chain checkpoint, separate from data restore. */
export async function exportSecurityAudit(db: PrismaClient, directory: string, name: string) {
  if (path.basename(name) !== name) throw Error("Invalid audit export name");
  const encryption = backupCipher(serverSecret("BACKUP_ENCRYPTION_KEY") || serverSecret("AI_KEY_SECRET"));
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `security-audit-${name}.enc`), temporary = `${file}.${randomUUID()}.tmp`;
  const output = createWriteStream(temporary, { mode: 0o600, flags: "wx" });
  output.write(encryption.header);
  const source = new PassThrough();
  const writing = pipeline(source, createGzip(), encryption.cipher, output);
  void writing.catch(() => undefined);
  try {
    await db.$transaction(async tx => {
      const head = await tx.securityAuditHead.findUnique({ where: { id: "global" } });
      async function write(value: unknown) { if (!source.write(JSON.stringify(value) + "\n")) await once(source, "drain"); }
      await write({ format: "mybot-security-audit", version: 1, sequence: String(head?.sequence ?? 0), checkpoint: head?.hash ?? "0".repeat(64) });
      let after = BigInt(0);
      for (;;) {
        const rows = await tx.securityAudit.findMany({ where: { sequence: { gt: after } }, orderBy: { sequence: "asc" }, take: 200 });
        if (!rows.length) break;
        for (const row of rows) await write({ ...row, sequence: String(row.sequence) });
        after = rows[rows.length - 1].sequence;
      }
      source.end(); await writing;
    }, { isolationLevel: "RepeatableRead", timeout: 120_000 });
    await appendFile(temporary, encryption.cipher.getAuthTag()); await chmod(temporary, 0o600); await rename(temporary, file);
    const remote = await uploadBackup(file, path.basename(file));
    return { file, remote: Boolean(remote) };
  } catch (error) { source.destroy(); output.destroy(); await writing.catch(() => undefined); await rm(temporary, { force: true }); throw error; }
}
