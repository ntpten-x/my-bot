import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { prisma } from "./prisma";
import { upsertSettings } from "./settings";
import { bangkokClock } from "./smart/summary";
import { shouldSendSummary } from "./smart/summary";

/** Every table, in an order that respects foreign keys when restoring. */
export const BACKUP_TABLES = [
  "Owner", "Session", "Source", "Category", "Post", "AiJob", "OcrCache", "Feedback", "PreferenceWeight",
  "Summary", "Keyword", "Note", "Notification", "Setting", "AiCache", "FetchTask", "ParseSample", "FetchLog",
  "ReplyTemplate", "AutomationRule", "RuleHit", "ReplyQueueItem", "FbAccount", "ExtensionHeartbeat",
] as const;

type Delegate = { findMany: (args?: unknown) => Promise<unknown[]> };

export function backupsToDelete(files: { name: string; mtimeMs: number }[], now: number, keepDays = 14) {
  const cutoff = now - keepDays * 24 * 3600 * 1000;
  return files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.(db|json\.gz)$/.test(file.name) && file.mtimeMs < cutoff)
    .map((file) => file.name);
}

/** Snapshot of all rows as gzip JSON. Restore with `npm run db:restore -- <file> --replace`. */
export async function exportDatabase() {
  const tables: Record<string, unknown[]> = {};
  for (const model of BACKUP_TABLES) {
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    tables[model] = await (prisma as unknown as Record<string, Delegate>)[key].findMany();
  }
  return gzipSync(JSON.stringify({ format: "mybot-backup", version: 1, createdAt: new Date().toISOString(), tables }));
}

export async function backupDatabase(name?: string) {
  const day = bangkokClock().day;
  const directory = path.resolve("data", "backups");
  await mkdir(directory, { recursive: true });
  const file = name ?? `${day}.json.gz`;
  await writeFile(path.join(directory, file), await exportDatabase());
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
  } catch (error) {
    console.error("[backup]", error instanceof Error ? error.message : error);
  }
}