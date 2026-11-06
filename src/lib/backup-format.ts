import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

/** All tables, including transient state (Lease is exported but never replayed). */
export const BACKUP_TABLES = [
  "Owner", "Session", "Product", "Source", "Category", "Post", "AiJob", "OcrCache", "Feedback", "PreferenceWeight",
  "Summary", "Keyword", "Note", "Notification", "Setting", "AiCache", "FetchTask", "ParseSample", "FetchLog",
  "ReplyTemplate", "AutomationRule", "RuleHit", "ReplyQueueItem", "FbAccount", "ExtensionHeartbeat", "PostTombstone",
  "LabelCorrection", "AiProvider", "ExtensionPairingCode", "ExtensionDevice", "LoginGuard", "ScrapeRun", "Lease", "SentKey",
  "AutoCommentRule", "AutoCommentTemplate", "AutoCommentJob", "AutoCommentLog",
] as const;
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Delegate = { findMany(): Promise<Row[]>; createMany(args: { data: Row[] }): Promise<unknown>; deleteMany(): Promise<unknown>; count(): Promise<number> };
const models = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
const delegate = (db: unknown, model: string) => (db as Record<string, Delegate>)[model[0].toLowerCase() + model.slice(1)];
const checksum = (rows: Row[]) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");

export function makeBackup(tables: Tables) {
  return {
    format: "mybot-backup", version: 2, createdAt: new Date().toISOString(), tables,
    manifest: Object.fromEntries(BACKUP_TABLES.map(name => [name, { count: tables[name]?.length, sha256: checksum(tables[name] ?? []) }])),
  };
}

/** Validate before connecting/deleting. v1 is accepted only with explicit legacy consent. */
export function validateBackup(input: unknown, allowLegacy = false): Tables {
  if (!input || typeof input !== "object") throw new Error("Invalid backup");
  const data = input as ReturnType<typeof makeBackup>;
  if (data.format !== "mybot-backup" || ![1, 2].includes(data.version) || !data.tables || typeof data.tables !== "object") throw new Error("Unsupported backup format");
  if (data.version === 1 && !allowLegacy) throw new Error("Legacy backup: use --allow-legacy after reviewing missing tables");
  const legacyAutoTables = allowLegacy && BACKUP_TABLES.filter(name => name.startsWith("AutoComment"))
    .every(name => data.tables[name] === undefined && data.manifest?.[name] === undefined);
  const tables: Tables = {};
  for (const name of Object.keys(data.tables)) if (!models.has(name)) throw new Error("Backup contains an unknown table");
  for (const name of BACKUP_TABLES) {
    const rows = data.tables[name];
    const legacyAutoTable = legacyAutoTables && name.startsWith("AutoComment") && rows === undefined;
    if (!Array.isArray(rows) && !(data.version === 1 && allowLegacy && rows === undefined) && !legacyAutoTable) throw new Error(`Missing backup table: ${name}`);
    tables[name] = rows ?? [];
    if (data.version === 2 && !legacyAutoTable) {
      const entry = data.manifest?.[name];
      if (!entry || entry.count !== rows.length || entry.sha256 !== checksum(rows)) throw new Error(`Backup integrity check failed: ${name}`);
    }
    const fields = models.get(name)!.fields.filter(field => field.kind !== "object");
    const known = new Set(fields.map(field => field.name));
    const keys = new Set<string>();
    for (const row of tables[name]) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Invalid row: ${name}`);
      if (Object.keys(row).some(key => !known.has(key))) throw new Error(`Unknown field: ${name}`);
      for (const field of fields) {
        const value = row[field.name];
        if ((value === undefined || value === null) && field.isRequired && !field.hasDefaultValue && !field.isUpdatedAt) throw new Error(`Missing required field: ${name}.${field.name}`);
        if (value != null && field.type === "DateTime" && !Number.isFinite(new Date(String(value)).getTime())) throw new Error(`Invalid date: ${name}.${field.name}`);
      }
      const primary = fields.filter(field => field.isId).map(field => row[field.name]);
      if (primary.length && primary.every(value => value !== undefined)) {
        const key = JSON.stringify(primary);
        if (keys.has(key)) throw new Error(`Duplicate primary key: ${name}`);
        keys.add(key);
      }
    }
  }
  // Parent categories must exist; order inserts for immediate FK constraints.
  const pending = [...tables.Category];
  const sorted: Row[] = [];
  const seen = new Set<unknown>();
  while (pending.length) {
    const index = pending.findIndex(row => !row.parentId || seen.has(row.parentId));
    if (index < 0) throw new Error("Category tree has a missing parent or cycle");
    const [row] = pending.splice(index, 1);
    sorted.push(row); seen.add(row.id);
  }
  tables.Category = sorted;
  return tables;
}

export async function snapshotDatabase(db: PrismaClient) {
  return db.$transaction(async tx => {
    const tables: Tables = {};
    for (const name of BACKUP_TABLES) tables[name] = await delegate(tx, name).findMany();
    return makeBackup(tables);
  }, { isolationLevel: "RepeatableRead", timeout: 120_000 });
}

/** One transaction: any constraint/insert/count failure rolls the entire replacement back. */
export async function restoreDatabase(db: PrismaClient, input: unknown, allowLegacy = false) {
  const tables = validateBackup(input, allowLegacy);
  return db.$transaction(async tx => {
    // Block a standby worker from acquiring leadership between the check and commit.
    await tx.$executeRawUnsafe('LOCK TABLE "Lease" IN EXCLUSIVE MODE');
    // Do not replace a live worker's data. The caller must stop every host sharing this DB.
    const active = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Lease" WHERE "expiresAt" > now() LIMIT 1`;
    if (active.length) throw new Error("Stop all MY-BOT workers and wait for the lease to expire before restoring");
    for (const name of [...BACKUP_TABLES].reverse()) await delegate(tx, name).deleteMany();
    const counts: Record<string, number> = {};
    for (const name of BACKUP_TABLES) {
      const dates = models.get(name)!.fields.filter(field => field.type === "DateTime").map(field => field.name);
      const rows = (name === "Lease" ? [] : tables[name]).map(row => {
        const copy = { ...row };
        for (const field of dates) if (copy[field] != null && !(copy[field] instanceof Date)) copy[field] = new Date(String(copy[field]));
        if (name === "Post") delete copy.sortAt; // generated by Postgres
        if (name === "AiJob") {
          copy.claimToken = null;
          if (copy.status === "running") { copy.status = "pending"; copy.nextAttemptAt = new Date(); }
        }
        if (name === "Notification" && copy.channel === "external_sending") copy.channel = "external_pending";
        if (name === "AutoCommentJob") {
          copy.claimToken = null; copy.claimUntil = null;
          if (copy.status === "sending") copy.status = "uncertain";
          else if (["pending", "pending_ai", "browser_ready", "claimed"].includes(String(copy.status))) copy.status = "cancelled";
        }
        if (name === "Setting" && copy.key === "auto_comment_control") {
          let old = {};
          try { old = JSON.parse(String(copy.value)); } catch { /* fall back to disabled */ }
          copy.value = JSON.stringify({ ...old, state: "stopped", dryRun: true, emergency: true, generation: "restored-disabled", startedAt: new Date().toISOString() });
        }
        return copy;
      });
      for (let offset = 0; offset < rows.length; offset += 200) await delegate(tx, name).createMany({ data: rows.slice(offset, offset + 200) });
      counts[name] = await delegate(tx, name).count();
      if (counts[name] !== rows.length) throw new Error(`Restore count mismatch: ${name}`);
    }
    return counts;
  }, { isolationLevel: "Serializable", timeout: 120_000 });
}
