/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS helper loaded by vi.hoisted */
// Disposable Postgres schema for DB integration tests (call inside vi.hoisted, before importing prisma).
// Uses TEST_DATABASE_URL, else DIRECT_URL from the environment or .env (session pooler / direct connection;
// not the pgbouncer transaction pooler). Each run gets its own schema, dropped by dropTestSchema().
// Without a Postgres URL the DB suites are skipped.
const fs = require("node:fs");
const crypto = require("node:crypto");

function fromDotEnv(key) {
  if (!fs.existsSync(".env")) return "";
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return "";
}

function setupTestDatabase(prefix) {
  const base = process.env.TEST_DATABASE_URL || fromDotEnv("TEST_DATABASE_URL") || process.env.DIRECT_URL || fromDotEnv("DIRECT_URL");
  if (!base || !/^postgres(ql)?:/.test(base)) return { enabled: false, schema: "" };
  const schema = `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const url = new URL(base);
  url.searchParams.delete("pgbouncer");
  url.searchParams.set("schema", schema);
  url.searchParams.set("connection_limit", "3");
  process.env.DATABASE_URL = url.toString();
  process.env.DIRECT_URL = url.toString();
  return { enabled: true, schema };
}

async function dropTestSchema(prisma, schema) {
  if (!/^test_[a-z0-9_]+$/.test(schema)) throw new Error("Unsafe test schema name");
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

module.exports = { setupTestDatabase, dropTestSchema };