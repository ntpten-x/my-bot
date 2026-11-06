import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module");
  const helper = createRequire(`${process.cwd()}/package.json`)("./tests/helpers/pg-test-db.cjs");
  return { ...helper.setupTestDatabase("test_security"), drop: helper.dropTestSchema };
});
const classifier = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/ai/run", () => ({ classifyLeads: classifier }));
vi.mock("../../src/lib/log", () => ({ workerLog: vi.fn(async () => undefined) }));
import { prisma } from "../../src/lib/prisma";
import { snapshotDatabase, restoreDatabase } from "../../src/lib/backup-format";
import { ingestPosts } from "../../src/lib/ingest";
import { acquireLease, releaseLease } from "../../src/lib/lease";
import { processAiQueue } from "../../src/lib/ai/queue";

beforeAll(() => {
  if (!fixture.enabled) return;
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: process.env, stdio: "pipe" });
}, 180_000);
afterAll(async () => {
  if (fixture.enabled) await fixture.drop(prisma, fixture.schema);
  await prisma.$disconnect();
});

describe.skipIf(!fixture.enabled)("isolated Postgres security and recovery", () => {
  it("enables RLS on every application table in the actual migrated schema", async () => {
    const unprotected = await prisma.$queryRaw<{ name: string }[]>`
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${fixture.schema} AND c.relkind = 'r' AND NOT c.relrowsecurity`;
    expect(unprotected).toEqual([]);
  });

  it("denies reads and writes for an unprivileged Data API-style role", async () => {
    const role = `${fixture.schema}_anon`;
    // Controlled generated identifiers, never input from users or production config.
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${fixture.schema}" TO "${role}"`);
      await tx.$executeRawUnsafe(`GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA "${fixture.schema}" TO "${role}"`);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
      const rows = await tx.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${fixture.schema}"."Product"`);
      expect(rows).toEqual([]);
      expect(await tx.$executeRawUnsafe(`UPDATE "${fixture.schema}"."Product" SET name = 'denied'`)).toBe(0);
      await tx.$executeRawUnsafe("RESET ROLE");
      await tx.$executeRawUnsafe(`DROP OWNED BY "${role}"`);
      await tx.$executeRawUnsafe(`DROP ROLE "${role}"`);
    });
  });

  it("round-trips providers, device hashes, generated post dates and categories", async () => {
    await prisma.category.create({ data: { id: "parent", name: "parent", slug: "parent" } });
    await prisma.category.create({ data: { id: "child", name: "child", slug: "child", parentId: "parent" } });
    await prisma.source.create({ data: { id: "revision-source", name: "ทดสอบ", type: "facebook_group", url: "https://www.facebook.com/groups/987" } });
    await prisma.setting.createMany({ data: [{ key: "ai_provider", value: "rules" }, { key: "ocr_enabled", value: "false" }] });
    await prisma.aiProvider.create({ data: { name: "test provider", kind: "ollama" } });
    await prisma.extensionDevice.create({ data: { tokenHash: "test-only-hash", name: "test device" } });
    await ingestPosts({ sourceUrl: "https://www.facebook.com/groups/987", actor: "extension", posts: [{ url: "https://www.facebook.com/groups/987/posts/1", text: "ตามหาไอแพดมือสอง งบประมาณ…" }] });
    const snapshot = JSON.parse(JSON.stringify(await snapshotDatabase(prisma)));
    await restoreDatabase(prisma, snapshot);
    expect(await prisma.aiProvider.count()).toBe(1);
    expect(await prisma.extensionDevice.count()).toBe(1);
    expect((await prisma.post.findFirstOrThrow()).sortAt).not.toBeNull();
    expect((await prisma.category.findUniqueOrThrow({ where: { id: "child" } })).parentId).toBe("parent");
  });

  it("requeues a done job and invalidates caches/embedding when full text arrives", async () => {
    const post = await prisma.post.findFirstOrThrow();
    await prisma.aiJob.updateMany({ data: { status: "done" } });
    await prisma.post.update({ where: { id: post.id }, data: { embeddingJson: "[1,0]", embeddingConfig: "old", ocrText: "old OCR" } });
    const text = "ตามหาไอแพดมือสอง งบประมาณ 5000 บาท อยู่กรุงเทพครับ";
    await ingestPosts({ sourceUrl: "https://www.facebook.com/groups/987", actor: "extension", posts: [{ url: post.externalUrl, text }] });
    const revised = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(revised.text).toBe(text);
    expect(revised.contentHash).not.toBe(post.contentHash);
    expect(revised.textRevision).toBe(post.textRevision + 1);
    expect(revised.embeddingConfig).toBe("");
    expect(revised.ocrText).toBe("");
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { postId: post.id } })).status).toBe("pending");
  });

  it("rolls back every deletion/insert if a late table has an invalid foreign key", async () => {
    const snapshot = JSON.parse(JSON.stringify(await snapshotDatabase(prisma)));
    // Recompute a valid manifest: this tests database rollback, rather than checksum rejection.
    const { makeBackup } = await import("../../src/lib/backup-format");
    snapshot.tables.Note = [{ id: "bad-note", postId: "missing-post", body: "test", createdAt: new Date().toISOString() }];
    const before = await prisma.post.findMany();
    await expect(restoreDatabase(prisma, makeBackup(snapshot.tables))).rejects.toThrow();
    expect(await prisma.post.findMany()).toEqual(before);
    expect(await prisma.extensionDevice.count()).toBe(1);
  });

  it("refuses restore while a worker lease is active and excludes restored leases", async () => {
    const snapshot = JSON.parse(JSON.stringify(await snapshotDatabase(prisma)));
    expect(await acquireLease("worker", 10_000, "test-a")).toBe(true);
    expect(await acquireLease("worker", 10_000, "test-b")).toBe(false);
    await expect(restoreDatabase(prisma, snapshot)).rejects.toThrow(/Stop all/);
    await releaseLease("worker", "test-a");
    await restoreDatabase(prisma, snapshot);
    expect(await prisma.lease.count()).toBe(0);
  });

  it("fences a running response after a concurrent text revision, then completes the new revision", async () => {
    process.env.MYBOT_PROCESS = "worker";
    await prisma.setting.update({ where: { key: "ai_provider" }, data: { value: "ollama" } });
    const post = await prisma.post.findFirstOrThrow();
    const response = (id: string) => ({ results: [{ id, intent: "buyer", categorySlug: "other", subcategorySlug: null, province: null, isAd: false, suggestedReply: "new draft" }], providersById: { [id]: "test-ai" }, errors: [] });
    classifier.mockImplementationOnce(async () => {
      await ingestPosts({ sourceUrl: "https://www.facebook.com/groups/987", actor: "extension", posts: [{ url: post.externalUrl, text: "ตามหาไอแพดมือสอง งบ 9000 บาท ขอรูปและรายละเอียดครับ" }] });
      return response(post.id);
    });
    await processAiQueue();
    const revised = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(revised.aiProvider).toBe("rules");
    const pending = await prisma.aiJob.findUniqueOrThrow({ where: { postId: post.id } });
    expect(pending.status).toBe("pending");
    expect(pending.attempts).toBe(0);
    expect(pending.claimToken).toBeNull();
    classifier.mockImplementationOnce(async () => response(post.id));
    await processAiQueue();
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { postId: post.id } })).status).toBe("done");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).aiProvider).toBe("test-ai");
  });

  it("stops applying AI results after a different worker takes the lease", async () => {
    const post = await prisma.post.findFirstOrThrow();
    await prisma.aiJob.updateMany({ data: { status: "pending", nextAttemptAt: new Date() } });
    await acquireLease("worker", 10_000, "old-worker");
    const guard = async () => {
      const row = await prisma.lease.findUnique({ where: { name: "worker" } });
      if (row?.holder !== "old-worker" || row.expiresAt.getTime() <= Date.now()) throw new Error("Worker lease lost");
    };
    classifier.mockImplementationOnce(async () => {
      await prisma.lease.update({ where: { name: "worker" }, data: { expiresAt: new Date(0) } });
      expect(await acquireLease("worker", 10_000, "new-worker")).toBe(true);
      return { results: [{ id: post.id, intent: "seller", categorySlug: "other" }], providersById: { [post.id]: "stale-ai" }, errors: [] };
    });
    await processAiQueue(guard);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).aiProvider).not.toBe("stale-ai");
    await releaseLease("worker", "old-worker");
    expect((await prisma.lease.findUniqueOrThrow({ where: { name: "worker" } })).holder).toBe("new-worker");
    await releaseLease("worker", "new-worker");
  });

  it("preserves owner labels on revision and does not resume owner-skipped jobs", async () => {
    const post = await prisma.post.findFirstOrThrow();
    await prisma.post.update({ where: { id: post.id }, data: { aiProvider: "owner", intent: "seller" } });
    await ingestPosts({ sourceUrl: "https://www.facebook.com/groups/987", actor: "extension", posts: [{ url: post.externalUrl, text: "ข้อความฉบับใหม่ที่เจ้าของจัดหมวดไว้แล้ว ต้องเก็บหมวดเดิม" }] });
    classifier.mockClear();
    expect(await processAiQueue()).toBe(0);
    expect(classifier).not.toHaveBeenCalled();
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { postId: post.id } })).status).toBe("skipped");
    const revised = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(revised.aiProvider).toBe("owner");
    expect(revised.intent).toBe("seller");
  });
});
