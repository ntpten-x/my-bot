/**
 * One-time copy of the old local SQLite database (data/mybot.db) into Postgres (Supabase).
 *
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts            # copy into an empty Postgres DB
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts --replace  # wipe the Postgres tables first
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts --verify   # only compare row counts and ids
 *
 * Source file: SQLITE_DATABASE_URL (default file:../data/mybot.db, relative to prisma/) or --sqlite <path>.
 * Target: DIRECT_URL (session pooler) if set, else DATABASE_URL. Run `npx prisma migrate deploy` first.
 * Ids, timestamps and all columns are preserved. Never prints connection strings.
 */
import "dotenv/config";
import path from "node:path";
import { existsSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";

// node:sqlite ships with Node 22.5+; @types/node 20 has no typings for it, so load it untyped.
type SqliteDb = { prepare: (sql: string) => { all: () => unknown[] }; close: () => void };
const { DatabaseSync } = (process as unknown as { getBuiltinModule: (id: string) => { DatabaseSync: new (file: string, options: { readOnly: boolean }) => SqliteDb } }).getBuiltinModule("node:sqlite");

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const verifyOnly = args.includes("--verify");
const sqliteArg = args.indexOf("--sqlite");

function sqlitePath() {
  if (sqliteArg >= 0 && args[sqliteArg + 1]) return path.resolve(args[sqliteArg + 1]);
  const url = process.env.SQLITE_DATABASE_URL || "file:../data/mybot.db";
  const file = url.replace(/^file:/, "");
  return path.isAbsolute(file) ? file : path.resolve("prisma", file);
}

// Insert order respects foreign keys (Category is sorted parent-first below).
const ORDER = [
  "Owner", "Session", "Source", "Category", "Post", "AiJob", "OcrCache", "Feedback", "PreferenceWeight",
  "Summary", "Keyword", "Note", "Notification", "Setting", "AiCache", "FetchTask", "ParseSample", "FetchLog",
  "ReplyTemplate", "AutomationRule", "RuleHit", "ReplyQueueItem",
];

type Row = Record<string, unknown>;
const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
let strippedNul = 0;

function delegate(db: PrismaClient, model: string) {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  return (db as unknown as Record<string, { createMany: (a: unknown) => Promise<{ count: number }>; deleteMany: () => Promise<unknown>; count: () => Promise<number>; findMany: (a: unknown) => Promise<Row[]> }>)[key];
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "bigint") return new Date(Number(value));
  const text = String(value);
  if (/^\d+$/.test(text)) return new Date(Number(text));
  // SQLite CURRENT_TIMESTAMP style "YYYY-MM-DD HH:MM:SS" is UTC.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Bad date value: ${text}`);
  return date;
}

function convert(model: string, row: Row): Row {
  const out: Row = {};
  for (const field of models.get(model)!.fields) {
    if (field.kind !== "scalar" && field.kind !== "enum") continue;
    if (!(field.name in row)) continue;
    const value = row[field.name];
    if (value === null || value === undefined) { out[field.name] = null; continue; }
    switch (field.type) {
      case "DateTime": out[field.name] = toDate(value); break;
      case "Boolean": out[field.name] = Number(value) === 1 || value === true || value === "1" || value === "true"; break;
      case "Int": out[field.name] = Number(value); break;
      case "Float": out[field.name] = Number(value); break;
      case "String": {
        const text = String(value);
        if (text.includes("\u0000")) strippedNul++;
        out[field.name] = text.replaceAll("\u0000", "");
        break;
      }
      default: out[field.name] = value;
    }
  }
  return out;
}

function sortCategories(rows: Row[]) {
  const done = new Set<string>();
  const sorted: Row[] = [];
  let pending = rows;
  while (pending.length) {
    const next = pending.filter((row) => !row.parentId || done.has(String(row.parentId)));
    if (!next.length) throw new Error("Category tree has a cycle or a missing parent");
    for (const row of next) { sorted.push(row); done.add(String(row.id)); }
    pending = pending.filter((row) => !done.has(String(row.id)));
  }
  return sorted;
}

function idField(model: string) {
  const field = models.get(model)!.fields.find((f) => f.isId);
  return field?.name ?? "id";
}

async function main() {
  const file = sqlitePath();
  if (!existsSync(file)) throw new Error(`SQLite file not found: ${file}`);
  const target = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!target || !/^postgres(ql)?:/.test(target)) throw new Error("DIRECT_URL/DATABASE_URL must be a postgresql:// URL");
  const sqlite = new DatabaseSync(file, { readOnly: true });
  const db = new PrismaClient({ datasourceUrl: target });
  const report: { table: string; sqlite: number; postgres: number; idsMatch: boolean }[] = [];
  try {
    const tables = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Row[]).map((r) => String(r.name)));
    const read = (model: string) => (tables.has(model) ? (sqlite.prepare(`SELECT * FROM "${model}"`).all() as Row[]) : []);

    if (!verifyOnly) {
      const existing = await Promise.all(ORDER.map((m) => delegate(db, m).count()));
      const total = existing.reduce((a, b) => a + b, 0);
      if (total > 0 && !replace) throw new Error(`Postgres already has ${total} rows. Re-run with --replace to wipe and copy again.`);
      if (replace) for (const model of [...ORDER].reverse()) await delegate(db, model).deleteMany();
      for (const model of ORDER) {
        let rows = read(model).map((row) => convert(model, row));
        if (model === "Category") rows = sortCategories(rows);
        for (let i = 0; i < rows.length; i += 200) {
          await delegate(db, model).createMany({ data: rows.slice(i, i + 200) });
        }
        console.log(`copied ${model}: ${rows.length}`);
      }
    }

    for (const model of ORDER) {
      const id = idField(model);
      const sourceIds = read(model).map((row) => String(row[id])).sort();
      const targetIds = (await delegate(db, model).findMany({ select: { [id]: true } })).map((row) => String(row[id])).sort();
      report.push({ table: model, sqlite: sourceIds.length, postgres: targetIds.length, idsMatch: sourceIds.join("\n") === targetIds.join("\n") });
    }
    console.table(report);
    if (strippedNul) console.log(`note: removed NUL characters from ${strippedNul} text values (Postgres does not allow them)`);
    const bad = report.filter((r) => r.sqlite !== r.postgres || !r.idsMatch);
    if (bad.length) { console.error(`MISMATCH in: ${bad.map((r) => r.table).join(", ")}`); process.exitCode = 1; }
    else console.log(`OK: ${report.reduce((a, r) => a + r.postgres, 0)} rows in ${report.length} tables match`);
  } finally {
    sqlite.close();
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[migrate-sqlite-to-postgres]", error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/[^\s"']+/g, "postgresql://***") : error);
  process.exit(1);
});