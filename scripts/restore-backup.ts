/**
 * Restore a MY-BOT backup (data/backups/*.json.gz) into the database in DATABASE_URL / DIRECT_URL.
 *   npm run db:restore -- data/backups/2026-11-04.json.gz --replace
 * --replace is required: it deletes every MY-BOT row first. Stop MY-BOT before restoring.
 */
import "../src/lib/load-env";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { PrismaClient } from "@prisma/client";
import { restoreDatabase, validateBackup } from "../src/lib/backup-format";

async function main() {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!file) throw new Error("usage: npm run db:restore -- <backup.json.gz> --replace");
  if (!process.argv.includes("--replace") && !process.argv.includes("--check")) throw new Error("add --replace to confirm: all current MY-BOT rows will be deleted first");
  const raw = readFileSync(file);
  const data: unknown = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
  const allowLegacy = process.argv.includes("--allow-legacy");
  validateBackup(data, allowLegacy);
  if (process.argv.includes("--check")) { console.log("Backup validation passed (no database changes)"); return; }
  if (allowLegacy) console.warn("Legacy restore: tables absent from the file will be empty. Active leases are never replayed.");
  const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL });
  try {
    const counts = await restoreDatabase(db, data, allowLegacy);
    for (const [model, count] of Object.entries(counts)) console.log(`restored ${model}: ${count}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[restore]", error instanceof Error ? "Restore failed; no partial transaction was committed. Check backup integrity, constraints, and stopped workers." : error);
  process.exit(1);
});