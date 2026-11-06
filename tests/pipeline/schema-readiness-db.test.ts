import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const helper = process.getBuiltinModule("node:module").createRequire(`${process.cwd()}/package.json`)("./tests/helpers/pg-test-db.cjs");
  return { ...helper.setupTestDatabase("test_schema_readiness"), drop: helper.dropTestSchema };
});
import { prisma } from "../../src/lib/prisma";
import { schemaReadiness } from "../../src/lib/schema-readiness";
beforeAll(() => { if (fixture.enabled) execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { stdio: "pipe" }); }, 180000);
afterAll(async () => { if (fixture.enabled) { await fixture.drop(prisma, fixture.schema); await prisma.$disconnect(); } });
describe.skipIf(!fixture.enabled)("read-only deployment schema diagnostics", () => {
  it("accepts a fully migrated test schema", async () => {
    expect(await schemaReadiness()).toEqual({ ready: true, missing: [] });
  });
  it("detects the live missing textRevision column even though SELECT 1 succeeds", async () => {
    await expect(prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE "Post" RENAME COLUMN "textRevision" TO "test_text_revision"');
      await tx.$queryRaw`SELECT 1`;
      expect(await schemaReadiness(tx)).toEqual({ ready: false, missing: ["Post.textRevision"] });
      throw new Error("rollback synthetic schema change");
    })).rejects.toThrow("rollback synthetic schema change");
    expect((await schemaReadiness()).ready).toBe(true);
  });
  it("detects missing automation tables and browser transport fields", async () => {
    await expect(prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE "AutoCommentJob" RENAME TO "TestAutoCommentJob"');
      await tx.$executeRawUnsafe('ALTER TABLE "AutoCommentRule" RENAME COLUMN "deliveryMode" TO "test_delivery_mode"');
      const result = await schemaReadiness(tx);
      expect(result.ready).toBe(false); expect(result.missing).toContain("AutoCommentRule.deliveryMode"); expect(result.missing).toContain("AutoCommentJob.id");
      throw new Error("rollback synthetic schema change");
    })).rejects.toThrow("rollback synthetic schema change");
  });
});
