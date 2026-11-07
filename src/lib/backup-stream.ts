import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { BACKUP_TABLES } from "./backup-format";

/** Same v2 manifest as makeBackup, bounded pages and async compression downstream. */
export async function writeBackupJson(db: PrismaClient, write: (chunk: string) => Promise<void>) {
  await db.$transaction(async tx => {
    await write('{"format":"mybot-backup","version":2,"createdAt":' + JSON.stringify(new Date().toISOString()) + ',"tables":{');
    const manifest: Record<string, { count: number; sha256: string }> = {};
    for (const [index, name] of BACKUP_TABLES.entries()) {
      if (index) await write(","); await write(JSON.stringify(name) + ":[");
      const model = Prisma.dmmf.datamodel.models.find(row => row.name === name)!;
      const key = model.fields.find(field => field.isId)!.name;
      const delegate = (tx as unknown as Record<string, { findMany(args: unknown): Promise<Record<string, unknown>[]> }>)[name[0].toLowerCase() + name.slice(1)];
      let cursor: unknown; let count = 0;
      const hash = createHash("sha256").update("[");
      for (;;) {
        const rows = await delegate.findMany({ take: 500, orderBy: { [key]: "asc" }, ...(cursor === undefined ? {} : { cursor: { [key]: cursor }, skip: 1 }) });
        if (!rows.length) break;
        for (const row of rows) { const part = (count++ ? "," : "") + JSON.stringify(row); hash.update(part); await write(part); }
        cursor = rows[rows.length - 1][key];
      }
      await write("]"); manifest[name] = { count, sha256: hash.update("]").digest("hex") };
    }
    await write('},"manifest":' + JSON.stringify(manifest) + "}");
  }, { isolationLevel: "RepeatableRead", timeout: 120_000 });
}
