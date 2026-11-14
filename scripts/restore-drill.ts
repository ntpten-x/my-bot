import "../src/lib/load-env";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { decodeBackup } from "../src/lib/backup-crypto";
import { restoreDatabase, validateBackup } from "../src/lib/backup-format";
async function main() {
  const file = process.argv.slice(2).find(arg => !arg.startsWith("--"));
  if (!file) throw Error("Supply an encrypted backup file; default validates without DB changes");
  const data = JSON.parse(decodeBackup(readFileSync(file)).toString("utf8"));
  validateBackup(data, process.argv.includes("--allow-legacy"));
  if (!process.argv.includes("--lab")) { console.log("PASS encrypted backup validation; no database contacted"); return; }
  const base = new URL(process.env.TEST_DATABASE_URL || "postgresql://invalid");
  const socket = base.searchParams.get("host") || "";
  const socketLab = base.hostname === "localhost" && /^\/tmp\/mybot-cadence-pg-[A-Za-z0-9]+$/.test(socket);
  const ciLab = process.env.CI === "true" && process.env.MYBOT_TEST_LAB === "1" && ["localhost", "127.0.0.1"].includes(base.hostname) && base.port === "5432" && base.pathname === "/postgres";
  if (!socketLab && !ciLab) throw Error("Restore drill requires the isolated socket cluster or the explicitly declared CI service");
  const schema = `test_restore_drill_${randomUUID().replaceAll("-", "")}`;
  base.searchParams.set("schema", schema);
  const db = new PrismaClient({ datasourceUrl: base.toString() });
  try {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: base.toString(), DIRECT_URL: base.toString() }, stdio: "pipe" });
    const counts = await restoreDatabase(db, data, process.argv.includes("--allow-legacy"));
    console.log(JSON.stringify({ restored: true, tables: Object.keys(counts).length, sessionsRevoked: counts.Session === 0 }));
  } finally { await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.$disconnect(); }
}
main().catch(() => { console.error("FAIL restore drill (backup contents and credentials withheld)"); process.exitCode = 1; });
