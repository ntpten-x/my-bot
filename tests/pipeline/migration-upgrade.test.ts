import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module");
  const helper = createRequire(`${process.cwd()}/package.json`)("./tests/helpers/pg-test-db.cjs");
  return { ...helper.setupTestDatabase("test_upgrade"), drop: helper.dropTestSchema };
});
import { prisma } from "../../src/lib/prisma";
const migration = "20261109100000_security_stability";
let directory: string;
const deploy = (schema = "prisma/schema.prisma") => execFileSync(process.execPath,
  [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", schema], { env: process.env, stdio: "pipe" });

beforeAll(() => {
  if (!fixture.enabled) return;
  directory = mkdtempSync(path.join(tmpdir(), "mybot-old-migrations-"));
  mkdirSync(path.join(directory, "migrations"));
  for (const name of readdirSync("prisma/migrations")) {
    if (!/^\d/.test(name) || name < migration) cpSync(path.join("prisma/migrations", name), path.join(directory, "migrations", name), { recursive: true });
  }
  const previousSchema = readFileSync("prisma/schema.prisma", "utf8")
    .replace(/^\s*textRevision\s+Int[^\n]*\n/m, "\n").replace(/^\s*claimToken\s+String\?[^\n]*\n/m, "\n");
  writeFileSync(path.join(directory, "schema.prisma"), previousSchema);
  deploy(path.join(directory, "schema.prisma"));
}, 180_000);
afterAll(async () => {
  if (fixture.enabled) await fixture.drop(prisma, fixture.schema);
  await prisma.$disconnect();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe.skipIf(!fixture.enabled)("upgrade rehearsal on a disposable pre-security database", () => {
  it("preserves existing data when enabling RLS and adding revision/claim fields", async () => {
    await prisma.$executeRaw`INSERT INTO "Source" (id, type, name, url, "updatedAt") VALUES ('existing-source', 'rss', 'test', 'https://example.test/feed', now())`;
    await prisma.$executeRaw`INSERT INTO "Post" (id, "sourceId", "externalUrl", text, "normalizedText", "contentHash", "updatedAt") VALUES ('existing-post', 'existing-source', 'https://example.test/post', 'preserved text', 'preserved text', 'test-upgrade-hash', now())`;
    const before = await prisma.$queryRaw<{ enabled: boolean }[]>`SELECT c.relrowsecurity AS enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${fixture.schema} AND c.relname='Product'`;
    expect(before[0].enabled).toBe(false); // Proves we exercised the actual upgrade path.
    deploy();
    const post = await prisma.post.findUniqueOrThrow({ where: { id: "existing-post" } });
    expect(post.text).toBe("preserved text");
    expect(post.contentHash).toBe("test-upgrade-hash");
    expect(post.textRevision).toBe(0);
    const unprotected = await prisma.$queryRaw<{ name: string }[]>`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${fixture.schema} AND c.relkind='r' AND NOT c.relrowsecurity`;
    expect(unprotected).toEqual([]);
  });

  it("re-deploys as a no-op and supports legacy SQL without dropping the security additions", async () => {
    deploy();
    await prisma.$executeRaw`UPDATE "Post" SET text='legacy-compatible write' WHERE id='existing-post'`;
    expect(await prisma.post.count()).toBe(1);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: "existing-post" } })).textRevision).toBe(0);
    const applied = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "_prisma_migrations" WHERE migration_name=${migration} AND finished_at IS NOT NULL`;
    expect(Number(applied[0].count)).toBe(1);
  });
});
