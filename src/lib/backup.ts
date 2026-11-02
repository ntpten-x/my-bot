import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";
import { upsertSettings } from "./settings";
import { bangkokClock } from "./smart/summary";
import { shouldSendSummary } from "./smart/summary";

export function backupsToDelete(files: { name: string; mtimeMs: number }[], now: number, keepDays = 14) {
  const cutoff = now - keepDays * 24 * 3600 * 1000;
  return files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.db$/.test(file.name) && file.mtimeMs < cutoff)
    .map((file) => file.name);
}

export async function backupDatabase() {
  const day = bangkokClock().day;
  const directory = path.resolve("data", "backups");
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${day}.db`).replaceAll("\\", "/");
  await unlink(destination).catch(() => undefined);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  const entries = await readdir(directory);
  const files = await Promise.all(
    entries.map(async (name) => ({ name, mtimeMs: (await stat(path.join(directory, name))).mtimeMs })),
  );
  for (const name of backupsToDelete(files, Date.now())) {
    await unlink(path.join(directory, name)).catch(() => undefined);
  }
  await upsertSettings({
    backup_last_at: new Date().toISOString(),
    backup_last_file: `data/backups/${day}.db`,
  });
  return `data/backups/${day}.db`;
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
