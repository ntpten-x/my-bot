import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module");
  const helper = createRequire(`${process.cwd()}/package.json`)("./tests/helpers/pg-test-db.cjs");
  return { ...helper.setupTestDatabase("test_comment"), drop: helper.dropTestSchema };
});
vi.mock("../../src/lib/log", () => ({ workerLog: vi.fn(async () => undefined) }));
import { prisma } from "../../src/lib/prisma";
import { saveCommentRule } from "../../src/lib/auto-comment/admin";
import { autoCommentRuleSchema } from "../../src/lib/auto-comment/schema";
import { updateCommentControl, readCommentControl } from "../../src/lib/auto-comment/control";
import { scanAutoCommentPosts, processAutoCommentQueue, autoCommentDashboard } from "../../src/lib/auto-comment/engine";
import { CommentApiError } from "../../src/lib/auto-comment/facebook";
import { snapshotDatabase, restoreDatabase } from "../../src/lib/backup-format";
import { autoCommentTick } from "../../src/lib/auto-comment/poll";
import { ingestPosts } from "../../src/lib/ingest";

const gateway = () => ({ verify: vi.fn(async () => undefined), checkPost: vi.fn(async () => undefined), send: vi.fn(async () => ({ id: "12345_999" })), posts: vi.fn(async () => []) });
let serial = 0;
async function setup(live = true) {
  const input = autoCommentRuleSchema.parse({ name: "กฎทดสอบ", enabled: true, pageId: "12345", templates: ["ทดสอบหนึ่ง", "ทดสอบสอง"], pageToken: "synthetic-page", managerToken: "synthetic-manager" });
  const ruleId = await saveCommentRule(input);
  if (live) await updateCommentControl({ dryRun: false, liveAcknowledged: true });
  await updateCommentControl({ action: "start" });
  const source = await prisma.source.findUniqueOrThrow({ where: { url: "https://www.facebook.com/12345" } });
  return { ruleId, input, source };
}
async function addPost(sourceId: string, url?: string) {
  return prisma.post.create({ data: { sourceId, externalUrl: url ?? `https://www.facebook.com/12345/posts/${++serial}`, text: "ตามหาอุปกรณ์มือสอง", normalizedText: "ตามหาอุปกรณ์มือสอง", contentHash: `test-hash-${++serial}` } });
}
async function queued() { const state = await setup(); const post = await addPost(state.source.id); await scanAutoCommentPosts(); return { ...state, post, job: await prisma.autoCommentJob.findFirstOrThrow() }; }

beforeAll(() => {
  if (!fixture.enabled) return;
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: process.env, stdio: "pipe" });
}, 180000);
beforeEach(async () => {
  if (!fixture.enabled) return;
  process.env.MYBOT_PROCESS = "worker";
  process.env.AI_KEY_SECRET = "synthetic-test-only-secret-at-least-32-characters";
  await prisma.autoCommentLog.deleteMany(); await prisma.autoCommentJob.deleteMany(); await prisma.autoCommentTemplate.deleteMany(); await prisma.autoCommentRule.deleteMany();
  await prisma.aiJob.deleteMany(); await prisma.post.deleteMany(); await prisma.source.deleteMany(); await prisma.setting.deleteMany();
});
afterAll(async () => { if (fixture.enabled) await fixture.drop(prisma, fixture.schema); await prisma.$disconnect(); });

describe.skipIf(!fixture.enabled)("auto comment isolated Postgres queue and migration", () => {
  it("migrates all four tables with RLS and unique post idempotency", async () => {
    const rows = await prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${fixture.schema} AND c.relname IN ('AutoCommentRule','AutoCommentTemplate','AutoCommentJob','AutoCommentLog')`;
    expect(rows).toHaveLength(4); expect(rows.every(row => row.relrowsecurity)).toBe(true);
  });
  it("denies reads and updates of all new tables to an unprivileged role", async () => {
    await queued(); const role = `${fixture.schema}_anon`;
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${fixture.schema}" TO "${role}"`);
      await tx.$executeRawUnsafe(`GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA "${fixture.schema}" TO "${role}"`);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
      for (const table of ["AutoCommentRule", "AutoCommentTemplate", "AutoCommentJob", "AutoCommentLog"]) {
        expect(await tx.$queryRawUnsafe(`SELECT * FROM "${fixture.schema}"."${table}"`)).toEqual([]);
      }
      expect(await tx.$executeRawUnsafe(`UPDATE "${fixture.schema}"."AutoCommentRule" SET enabled = true`)).toBe(0);
      await tx.$executeRawUnsafe("RESET ROLE"); await tx.$executeRawUnsafe(`DROP OWNED BY "${role}"`); await tx.$executeRawUnsafe(`DROP ROLE "${role}"`);
    });
  });
  it("starts stopped, requires live acknowledgement and never sends a Dry Run", async () => {
    expect((await readCommentControl()).state).toBe("stopped");
    await expect(updateCommentControl({ dryRun: false })).rejects.toThrow(/ยืนยัน/);
    const { source } = await setup(false); await addPost(source.id);
    expect(await scanAutoCommentPosts()).toBe(1);
    const api = gateway(); expect(await processAutoCommentQueue({ gateway: api })).toBe(0);
    expect(api.verify).not.toHaveBeenCalled(); expect(api.send).not.toHaveBeenCalled();
    expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("dry_run");
  });
  it("sends one comment per canonical post across scans, competing rules and restarts", async () => {
    const { source, input } = await setup(); await saveCommentRule({ ...input, name: "กฎซ้ำ" });
    await addPost(source.id, "https://www.facebook.com/12345/posts/555");
    await addPost(source.id, "https://m.facebook.com/story.php?id=12345&story_fbid=555");
    await Promise.all([scanAutoCommentPosts(), scanAutoCommentPosts()]);
    expect(await prisma.autoCommentJob.count()).toBe(1);
    const api = gateway(); await Promise.all([processAutoCommentQueue({ gateway: api }), processAutoCommentQueue({ gateway: api })]);
    await scanAutoCommentPosts(); await processAutoCommentQueue({ gateway: api });
    expect(api.send).toHaveBeenCalledTimes(1);
    expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("sent");
    expect(await prisma.autoCommentLog.count({ where: { event: "dispatch" } })).toBe(1);
  });
  it("preserves post idempotency even after a captured post is deleted and imported again", async () => {
    const { job, post, source } = await queued(); const api = gateway(); await processAutoCommentQueue({ gateway: api });
    await prisma.post.delete({ where: { id: post.id } });
    expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: job.id } })).postId).toBeNull();
    await addPost(source.id, post.externalUrl); await scanAutoCommentPosts(); await processAutoCommentQueue({ gateway: api });
    expect(await prisma.autoCommentJob.count()).toBe(1); expect(api.send).toHaveBeenCalledTimes(1);
  });
  it("prepares unsupported group drafts and never calls Meta", async () => {
    const source = await prisma.source.create({ data: { name: "กลุ่ม", url: "https://www.facebook.com/groups/777", type: "facebook_group" } });
    await saveCommentRule(autoCommentRuleSchema.parse({ name: "กลุ่ม", enabled: true, sourceIds: [source.id], templates: ["ส่งเอง"] }));
    await updateCommentControl({ dryRun: false, liveAcknowledged: true }); await updateCommentControl({ action: "start" });
    await addPost(source.id, "https://www.facebook.com/groups/777/posts/1"); await scanAutoCommentPosts();
    const api = gateway(); await processAutoCommentQueue({ gateway: api });
    expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("unsupported"); expect(api.verify).not.toHaveBeenCalled();
  });
  it("recovers pre-send claims after restart, but never repeats uncertain sends", async () => {
    const { job } = await queued(); const api = gateway();
    await prisma.autoCommentJob.update({ where: { id: job.id }, data: { status: "claimed", claimToken: "dead-worker", claimUntil: new Date(0) } });
    await processAutoCommentQueue({ gateway: api }); expect(api.send).toHaveBeenCalledTimes(1);
    await prisma.autoCommentJob.update({ where: { id: job.id }, data: { status: "sending", claimToken: "dead-worker", claimUntil: new Date(0) } });
    await processAutoCommentQueue({ gateway: api });
    expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("uncertain"); expect(api.send).toHaveBeenCalledTimes(1);
  });
  it("bounds retries to three explicit transient failures", async () => {
    const { job } = await queued(); const api = gateway(); api.verify.mockRejectedValue(new CommentApiError("transient", "ชั่วคราว"));
    for (let attempt = 0; attempt < 4; attempt++) { await prisma.autoCommentJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(0) } }); await processAutoCommentQueue({ gateway: api }); }
    expect(api.verify).toHaveBeenCalledTimes(3); expect(api.send).not.toHaveBeenCalled();
    expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("failed");
  });
  it.each(["permission", "rate", "unavailable", "uncertain"] as const)("handles %s without unsafe retries", async kind => {
    const { ruleId, job } = await queued(); const api = gateway();
    if (kind === "uncertain") api.send.mockRejectedValue(new CommentApiError(kind, "จำลอง"));
    else api.verify.mockRejectedValue(new CommentApiError(kind, "จำลอง", 120000));
    await processAutoCommentQueue({ gateway: api });
    const result = await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: job.id } }); const control = await readCommentControl();
    expect(result.status).toBe({ permission: "permission_denied", rate: "pending", unavailable: "unavailable", uncertain: "uncertain" }[kind]);
    if (kind === "permission") { expect(control.state).toBe("paused"); expect((await prisma.autoCommentRule.findUniqueOrThrow({ where: { id: ruleId } })).pausedReason).toBeTruthy(); }
    if (kind === "rate") expect(Date.parse(control.cooldownUntil!)).toBeGreaterThan(Date.now());
    await processAutoCommentQueue({ gateway: api }); expect(api.send).toHaveBeenCalledTimes(kind === "uncertain" ? 1 : 0);
  });
  it.each(["hourly", "daily", "area"])("enforces %s limits before dispatch", async limit => {
    const { source } = await setup(); await addPost(source.id); await addPost(source.id); await scanAutoCommentPosts();
    await updateCommentControl(limit === "hourly" ? { hourlyLimit: 1 } : limit === "daily" ? { dailyLimit: 1 } : {});
    const api = gateway(); await processAutoCommentQueue({ gateway: api }); await processAutoCommentQueue({ gateway: api });
    expect(api.send).toHaveBeenCalledTimes(1); expect(await prisma.autoCommentJob.count({ where: { status: "pending" } })).toBe(1);
  });
  it("stops before POST if Emergency Stop arrives during permission preflight", async () => {
    await queued(); const api = gateway(); api.verify.mockImplementation(async () => { await updateCommentControl({ action: "emergency" }); });
    await processAutoCommentQueue({ gateway: api }); expect(api.send).not.toHaveBeenCalled();
    await expect(updateCommentControl({ action: "start" })).rejects.toThrow(/Emergency/);
    await updateCommentControl({ action: "reset" }); expect((await readCommentControl()).state).toBe("stopped");
  });
  it("stops after durable reservation but before beginning a remote POST", async () => {
    await queued(); const api = gateway(); let calls = 0;
    const sent = await processAutoCommentQueue({ gateway: api, assertActive: async () => { if (++calls === 4) await updateCommentControl({ action: "stop" }); } });
    expect(sent).toBe(0); expect(api.send).not.toHaveBeenCalled();
    expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("cancelled");
  });
  it("acknowledges Stop after an already-started HTTP request completes and never sends afterwards", async () => {
    await queued(); const api = gateway(); let release!: () => void; let began!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; }); const finish = new Promise<void>(resolve => { release = resolve; });
    api.send.mockImplementation(async () => { began(); await finish; return { id: "12345_999" }; });
    const processing = processAutoCommentQueue({ gateway: api }); await started;
    let stopped = false; const stopping = updateCommentControl({ action: "stop" }).then(() => { stopped = true; });
    expect(stopped).toBe(false); release(); await Promise.all([processing, stopping]);
    expect((await readCommentControl()).state).toBe("stopped"); await processAutoCommentQueue({ gateway: api }); expect(api.send).toHaveBeenCalledTimes(1);
  });
  it.each(["revision", "rule", "source"])("cancels stale %s jobs", async kind => {
    const { job, post, ruleId, input, source } = await queued();
    if (kind === "revision") await prisma.post.update({ where: { id: post.id }, data: { textRevision: { increment: 1 } } });
    if (kind === "rule") await saveCommentRule({ ...input, enabled: false }, ruleId);
    if (kind === "source") await prisma.source.update({ where: { id: source.id }, data: { enabled: false } });
    const api = gateway(); await processAutoCommentQueue({ gateway: api }); expect(api.send).not.toHaveBeenCalled();
    expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled");
  });
  it("rejects a lost worker lease and never runs from the web process", async () => {
    await queued(); const api = gateway();
    await expect(processAutoCommentQueue({ gateway: api, assertActive: async () => { throw new Error("lease lost"); } })).rejects.toThrow("lease lost");
    process.env.MYBOT_PROCESS = "web"; expect(await scanAutoCommentPosts()).toBe(0); expect(await processAutoCommentQueue({ gateway: api })).toBe(0); expect(api.send).not.toHaveBeenCalled();
  });
  it("fences a worker that loses its lease during preflight", async () => {
    await queued(); const api = gateway(); let active = true;
    api.verify.mockImplementation(async () => { active = false; });
    await processAutoCommentQueue({ gateway: api, assertActive: async () => { if (!active) throw new Error("lease lost"); } });
    expect(api.send).not.toHaveBeenCalled(); expect(api.checkPost).not.toHaveBeenCalled();
    expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("pending");
  });
  it("coexists with ingestion and AI queue without consuming AI jobs", async () => {
    const { source } = await setup(false);
    await prisma.setting.create({ data: { key: "ai_provider", value: "rules" } });
    await ingestPosts({ sourceUrl: source.url, actor: "extension", posts: [{ url: "https://www.facebook.com/12345/posts/888", text: "ตามหาไอแพดมือสอง งบ 5000 บาท" }] });
    const aiBefore = await prisma.aiJob.findMany(); expect(aiBefore).toHaveLength(1); await scanAutoCommentPosts();
    expect(await prisma.aiJob.findMany()).toEqual(aiBefore); expect(await prisma.autoCommentJob.count()).toBe(1);
  });
  it("polls authorized Page posts through the existing ingest/AI path without sending Dry Run", async () => {
    await setup(false); const api = gateway();
    api.posts.mockResolvedValue([{ id: "12345_778899", message: "ตามหาไอแพดใหม่", created_time: new Date().toISOString() }] as never);
    await autoCommentTick(async () => undefined, { gateway: api });
    expect(api.posts).toHaveBeenCalledTimes(1); expect(api.send).not.toHaveBeenCalled();
    expect(await prisma.post.count()).toBe(1); expect(await prisma.aiJob.count()).toBe(1);
    expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("dry_run");
    await autoCommentTick(async () => undefined, { gateway: api }); expect(api.posts).toHaveBeenCalledTimes(1);
  });
  it("does not poll a disabled source and pauses on poll permission failure", async () => {
    const { source } = await setup(false); const api = gateway();
    await prisma.source.update({ where: { id: source.id }, data: { enabled: false } });
    await autoCommentTick(async () => undefined, { gateway: api }); expect(api.verify).not.toHaveBeenCalled();
    await prisma.source.update({ where: { id: source.id }, data: { enabled: true } });
    api.verify.mockRejectedValue(new CommentApiError("permission", "ทดสอบสิทธิ์"));
    await autoCommentTick(async () => undefined, { gateway: api });
    expect((await readCommentControl()).state).toBe("paused"); expect(api.send).not.toHaveBeenCalled();
  });
  it("does not pause newly edited credentials because of an obsolete poll failure", async () => {
    const { ruleId, input } = await setup(false); const api = gateway();
    api.verify.mockImplementation(async () => { await saveCommentRule({ ...input, pageToken: "synthetic-replacement" }, ruleId); throw new CommentApiError("permission", "old token"); });
    await autoCommentTick(async () => undefined, { gateway: api });
    expect((await readCommentControl()).state).toBe("running");
    expect((await prisma.autoCommentRule.findUniqueOrThrow({ where: { id: ruleId } })).pausedReason).toBe("");
  });
  it("never exposes encrypted credentials through dashboard and disables restored automation", async () => {
    await queued(); const dashboard = JSON.stringify(await autoCommentDashboard());
    expect(dashboard).not.toContain("synthetic-page"); expect(dashboard).not.toContain("synthetic-manager"); expect(dashboard).not.toContain("pageTokenEnc");
    const snapshot = JSON.parse(JSON.stringify(await snapshotDatabase(prisma))); await restoreDatabase(prisma, snapshot);
    expect(await readCommentControl()).toMatchObject({ state: "stopped", dryRun: true, emergency: true });
    expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("cancelled");
  });
});
