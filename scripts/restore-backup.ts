/**
 * Restore a MY-BOT backup (data/backups/*.json.gz) into the database in DATABASE_URL / DIRECT_URL.
 *   npm run db:restore -- data/backups/2026-11-04.json.gz --replace
 * --replace is required: it deletes every MY-BOT row first. Stop MY-BOT before restoring.
 */
import "../src/lib/load-env";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Prisma, PrismaClient } from "@prisma/client";
import { BACKUP_TABLES } from "../src/lib/backup";

type Row = Record<string, unknown>;
type Delegate = { createMany: (a: unknown) => Promise<unknown>; deleteMany: () => Promise<unknown>; count: () => Promise<number> };

async function main() {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!file) throw new Error("usage: npm run db:restore -- <backup.json.gz> --replace");
  if (!process.argv.includes("--replace")) throw new Error("add --replace to confirm: all current MY-BOT rows will be deleted first");
  const raw = readFileSync(file);
  const data = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as { format?: string; tables: Record<string, Row[]> };
  if (data.format !== "mybot-backup") throw new Error("not a MY-BOT backup file");
  const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL });
  const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
  const delegate = (model: string) => (db as unknown as Record<string, Delegate>)[model.charAt(0).toLowerCase() + model.slice(1)];
  try {
    for (const model of [...BACKUP_TABLES].reverse()) await delegate(model).deleteMany();
    for (const model of BACKUP_TABLES) {
      const dates = models.get(model)!.fields.filter((f) => f.type === "DateTime").map((f) => f.name);
      let rows = (data.tables[model] ?? []).map((row) => {
        const out = { ...row };
        for (const name of dates) if (typeof out[name] === "string") out[name] = new Date(out[name] as string);
        return out;
      });
      if (model === "Category") {
        const done = new Set<string>(); const sorted: Row[] = [];
        while (rows.length) {
          const next = rows.filter((r) => !r.parentId || done.has(String(r.parentId)));
          if (!next.length) throw new Error("Category tree has a missing parent");
          next.forEach((r) => { sorted.push(r); done.add(String(r.id)); });
          rows = rows.filter((r) => !done.has(String(r.id)));
        }
        rows = sorted;
      }
      for (let i = 0; i < rows.length; i += 200) await delegate(model).createMany({ data: rows.slice(i, i + 200) });
      console.log(`restored ${model}: ${rows.length}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[restore]", error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/[^\s"']+/g, "postgresql://***") : error);
  process.exit(1);
});