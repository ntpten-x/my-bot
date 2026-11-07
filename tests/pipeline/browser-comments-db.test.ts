import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const helper = process.getBuiltinModule("node:module").createRequire(`${process.cwd()}/package.json`)("./tests/helpers/pg-test-db.cjs");
  return { ...helper.setupTestDatabase("test_browser_comment"), drop: helper.dropTestSchema };
});
vi.mock("../../src/lib/auto-comment/draft", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/lib/auto-comment/draft")>();
  return { ...actual, generateCommentDraft: vi.fn(async (rule, post) => ({ message: "ร่างทดสอบ", provider: "synthetic", key: actual.draftKey(rule, post) })) };
});
import { prisma } from "../../src/lib/prisma";
import { autoCommentRuleSchema } from "../../src/lib/auto-comment/schema";
import { saveCommentRule } from "../../src/lib/auto-comment/admin";
import { updateCommentControl, readCommentControl } from "../../src/lib/auto-comment/control";
import { scanBrowserComments, prepareBrowserComments, claimBrowserComment, authorizeBrowserComment, reportBrowserComment } from "../../src/lib/auto-comment/browser";
import { autoCommentTick } from "../../src/lib/auto-comment/poll";
import { snapshotDatabase, restoreDatabase } from "../../src/lib/backup-format";
import { encodeSetting } from "../../src/lib/setting-secrets";
let serial = 0;
const active = async () => undefined;
beforeAll(() => { if (fixture.enabled) execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { stdio: "pipe" }); }, 180000);
beforeEach(async () => {
  if (!fixture.enabled) return;
  process.env.MYBOT_PROCESS = "worker"; process.env.AI_KEY_SECRET = "synthetic-browser-comment-test-key-only";
  await prisma.autoCommentLog.deleteMany(); await prisma.autoCommentJob.deleteMany(); await prisma.autoCommentTemplate.deleteMany(); await prisma.autoCommentRule.deleteMany();
  await prisma.aiJob.deleteMany(); await prisma.post.deleteMany(); await prisma.source.deleteMany(); await prisma.extensionDevice.deleteMany(); await prisma.setting.deleteMany(); await prisma.lease.deleteMany();
});
afterAll(async () => { if (fixture.enabled) { await fixture.drop(prisma, fixture.schema); await prisma.$disconnect(); } });
async function setup(options: { dry?: boolean; requireAi?: boolean; aiDraft?: boolean } = {}) {
  const device = await prisma.extensionDevice.create({ data: { name: "mock Chrome", tokenHash: `mock-${++serial}`, tokenHint: "mock" } });
  const source = await prisma.source.create({ data: { name: "synthetic group", type: "facebook_group", url: "https://www.facebook.com/groups/12345" } });
  const input = autoCommentRuleSchema.parse({ name: "ทดสอบ", enabled: true, deliveryMode: "extension", sourceIds: [source.id], templates: options.aiDraft ? [] : ["ข้อความทดสอบ"], keywords: "หาช่าง", browserDeviceId: device.id, browserFbUserId: "99887766", browserConsent: true, requireAi: options.requireAi ?? false, messageMode: options.aiDraft ? "ai_draft" : "template" });
  const ruleId = await saveCommentRule(input);
  if (!options.dry) await updateCommentControl({ dryRun: false, liveAcknowledged: true });
  await updateCommentControl({ action: "start" });
  await prisma.lease.create({ data: { name: "worker", holder: "synthetic", expiresAt: new Date(Date.now() + 150000) } });
  const post = await prisma.post.create({ data: { sourceId: source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/8888/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `post-${++serial}` } });
  await scanBrowserComments(active); await prepareBrowserComments(active);
  return { device, source, ruleId, input, post, job: await prisma.autoCommentJob.findFirstOrThrow() };
}
const claim = (deviceId: string) => claimBrowserComment(deviceId, "99887766");
const permit = (deviceId: string, job: { id: string; claimToken: string }) => authorizeBrowserComment(deviceId, job.id, job.claimToken, "99887766");

describe.skipIf(!fixture.enabled)("browser comment durable workflow on disposable Postgres", () => {
  it("records rejected posts and revisits them after AI changes without a createdAt change", async () => {
    const s = await setup({ dry: true, requireAi: true });
    const post = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/4444/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `post-${++serial}`, isAd: true } });
    await scanBrowserComments(active);
    expect(await prisma.autoCommentJob.count({ where: { postId: post.id } })).toBe(0);
    expect(await prisma.autoCommentEvaluation.findFirst({ where: { postId: post.id } })).toMatchObject({ state: "waiting_ai" });
    await prisma.aiJob.create({ data: { postId: post.id, status: "done" } });
    await prisma.post.update({ where: { id: post.id }, data: { isAd: false, aiProvider: "gemini:mock", intent: "buyer" } });
    await scanBrowserComments(active); await prepareBrowserComments(active);
    expect(await prisma.autoCommentJob.findFirst({ where: { postId: post.id } })).toMatchObject({ status: "dry_run", message: "ข้อความทดสอบ" });
    await scanBrowserComments(active); await scanBrowserComments(active);
    expect(await prisma.autoCommentJob.count({ where: { postId: post.id } })).toBe(1);
    expect(await prisma.autoCommentEvaluation.count({ where: { postId: post.id } })).toBe(1);
  });
  it("sends a configured shoe template only to buyer intent in Dry Run", async () => {
    const s = await setup({ dry: true });
    await saveCommentRule({ ...s.input, keywords: "รองเท้า", intentMode: "buyer", templates: ["แนะนำร้าน https://shopee.co.th/example"] }, s.ruleId);
    for (const [id, text] of [["1111", "หารองเท้าวิ่ง"], ["2222", "ขายรองเท้า"], ["3333", "ได้รองเท้าแล้ว"]]) {
      await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: `https://www.facebook.com/groups/12345/posts/${id}/`, text, normalizedText: text, contentHash: `post-${++serial}` } });
    }
    await scanBrowserComments(active); await prepareBrowserComments(active);
    const shoes = await prisma.autoCommentJob.findMany({ where: { message: { contains: "shopee" } } });
    expect(shoes).toHaveLength(1); expect(shoes[0]).toMatchObject({ status: "dry_run", externalUrl: "https://www.facebook.com/groups/12345/posts/1111/" });
    expect(await prisma.autoCommentEvaluation.count({ where: { state: "skipped" } })).toBeGreaterThanOrEqual(2);
    expect(await claim(s.device.id)).toBeNull();
  });
  it("repairs missing evaluations across batches without replaying deliveries", async () => {
    const s = await setup({ dry: true });
    await prisma.post.createMany({ data: Array.from({ length: 105 }, (_, index) => ({ sourceId: s.source.id, externalUrl: `https://www.facebook.com/groups/12345/posts/${5000 + index}/`, text: "ไม่ตรงกฎ", normalizedText: "ไม่ตรงกฎ", contentHash: `batch-${++serial}` })) });
    await scanBrowserComments(active); await scanBrowserComments(active);
    expect(await prisma.autoCommentEvaluation.count()).toBe(106);
    await prisma.autoCommentEvaluation.deleteMany({ where: { postId: s.post.id } });
    await scanBrowserComments(active);
    expect(await prisma.autoCommentEvaluation.count()).toBe(106); expect(await prisma.autoCommentJob.count()).toBe(1);
    await prisma.autoCommentEvaluation.updateMany({ data: { nextEvaluateAt: new Date(0) } });
    const fresh = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/9000/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `post-${++serial}` } });
    await scanBrowserComments(active);
    expect(await prisma.autoCommentEvaluation.findFirst({ where: { postId: fresh.id } })).not.toBeNull();
  });
  it("revisits text revisions and re-arms only never-dispatched cancelled jobs", async () => {
    const s = await setup({ requireAi: true });
    await prisma.post.update({ where: { id: s.post.id }, data: { textRevision: { increment: 1 }, text: "หาช่างแอร์ด่วน", aiProvider: "owner", intent: "buyer" } });
    await prisma.autoCommentJob.updateMany({ data: { nextAttemptAt: new Date(0) } });
    await prepareBrowserComments(active);
    expect(await prisma.autoCommentJob.findFirst()).toMatchObject({ status: "cancelled" });
    await scanBrowserComments(active); await prepareBrowserComments(active);
    expect(await prisma.autoCommentJob.findFirst()).toMatchObject({ id: s.job.id, textRevision: 1, status: "browser_ready" });
    const c = (await claim(s.device.id))!; await permit(s.device.id, c);
    await reportBrowserComment(s.device.id, c.id, c.claimToken, "uncertain");
    await prisma.post.update({ where: { id: s.post.id }, data: { textRevision: { increment: 1 } } });
    expect(await claim(s.device.id)).toBeNull();
    expect(await prisma.autoCommentJob.findFirst()).toMatchObject({ status: "uncertain", attempts: 1 });
  });
  it("prefers explicit rule priority and keeps evaluation table under RLS and backup", async () => {
    const s = await setup({ dry: true });
    await saveCommentRule({ ...s.input, name: "priority", priority: 100, templates: ["สำคัญก่อน"] });
    const post = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/6666/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `post-${++serial}` } });
    await scanBrowserComments(active); await prepareBrowserComments(active);
    expect(await prisma.autoCommentJob.findFirst({ where: { postId: post.id } })).toMatchObject({ message: "สำคัญก่อน" });
    const rows = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${fixture.schema} AND c.relname='AutoCommentEvaluation'`;
    expect(rows).toEqual([{ relrowsecurity: true }]);
    expect((await snapshotDatabase(prisma)).tables.AutoCommentEvaluation.length).toBeGreaterThan(0);
  });
  it("does not let a lower-priority rule bypass an applicable AI wait", async () => {
    const s = await setup({ dry: true });
    await saveCommentRule({ ...s.input, name: "AI priority", keywords: "รองเท้า", priority: 100, intentMode: "buyer", requireAi: true, templates: ["AI rule"] });
    await saveCommentRule({ ...s.input, name: "fallback", keywords: "รองเท้า", templates: ["fallback"] });
    const post = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/7777/", text: "รองเท้ารุ่นนี้", normalizedText: "รองเท้ารุ่นนี้", contentHash: `post-${++serial}` } });
    await scanBrowserComments(active); await prepareBrowserComments(active);
    expect(await prisma.autoCommentJob.count({ where: { postId: post.id } })).toBe(0);
    expect(await prisma.autoCommentEvaluation.findFirst({ where: { postId: post.id } })).toMatchObject({ state: "waiting_ai" });
    await prisma.aiJob.create({ data: { postId: post.id, status: "done" } });
    await prisma.post.update({ where: { id: post.id }, data: { aiProvider: "gemini:mock", intent: "buyer" } });
    await Promise.all([scanBrowserComments(active), scanBrowserComments(active)]); await prepareBrowserComments(active);
    expect(await prisma.autoCommentJob.findMany({ where: { postId: post.id } })).toMatchObject([{ message: "AI rule", status: "dry_run" }]);
  });
  it("rechecks disabled sources and scheduled checkpoints without creating duplicates", async () => {
    const s = await setup({ dry: true });
    await prisma.source.update({ where: { id: s.source.id }, data: { enabled: false } });
    const post = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/7778/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `post-${++serial}` } });
    await scanBrowserComments(active);
    expect(await prisma.autoCommentJob.count({ where: { postId: post.id } })).toBe(0);
    await prisma.source.update({ where: { id: s.source.id }, data: { enabled: true } });
    await scanBrowserComments(active); await prepareBrowserComments(active);
    await prisma.autoCommentEvaluation.updateMany({ where: { postId: post.id }, data: { state: "waiting_window", nextEvaluateAt: new Date(0) } });
    await scanBrowserComments(active);
    expect(await prisma.autoCommentEvaluation.findFirst({ where: { postId: post.id } })).toMatchObject({ nextEvaluateAt: null, state: "deduplicated" });
    expect(await prisma.autoCommentJob.count({ where: { postId: post.id } })).toBe(1);
  });
  it("denies evaluation reads and changes to an unprivileged database role", async () => {
    await setup({ dry: true });
    const role = `${fixture.schema}_anon`;
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${fixture.schema}" TO "${role}"`);
      await tx.$executeRawUnsafe(`GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA "${fixture.schema}" TO "${role}"`);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
      expect(await tx.$queryRawUnsafe(`SELECT * FROM "${fixture.schema}"."AutoCommentEvaluation"`)).toEqual([]);
      expect(await tx.$executeRawUnsafe(`UPDATE "${fixture.schema}"."AutoCommentEvaluation" SET state='matched'`)).toBe(0);
      await tx.$executeRawUnsafe("RESET ROLE");
      await tx.$executeRawUnsafe(`DROP OWNED BY "${role}"`); await tx.$executeRawUnsafe(`DROP ROLE "${role}"`);
    });
  });
  it("does not create jobs in a web process", async () => {
    const s = await setup(); await prisma.autoCommentJob.deleteMany(); process.env.MYBOT_PROCESS = "web";
    await scanBrowserComments(active); expect(await prisma.autoCommentJob.count()).toBe(0); expect(await claim(s.device.id)).toBeNull();
  });
  it("never offers Dry Run jobs to a browser", async () => {
    const s = await setup({ dry: true }); expect(s.job.status).toBe("dry_run"); expect(await claim(s.device.id)).toBeNull();
  });
  it("fences wrong devices, accounts and duplicate claims", async () => {
    const s = await setup(); expect(await claim("other-device")).toBeNull();
    expect(await claimBrowserComment(s.device.id, "11111111")).toBeNull();
    const results = await Promise.all([claim(s.device.id), claim(s.device.id)]); expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claim(s.device.id)).toBeNull();
  });
  it("commits sending and dispatch before issuing a single-use grant", async () => {
    const s = await setup(), c = (await claim(s.device.id))!;
    expect(await permit(s.device.id, c)).toMatchObject({ ttlMs: 3000 });
    expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("sending");
    expect(await prisma.autoCommentLog.count({ where: { event: "dispatch" } })).toBe(1);
    expect(await permit(s.device.id, c)).toBeNull();
  });
  it.each(["stop", "emergency", "pause"] as const)("refuses authorization after %s", async action => {
    const s = await setup(), c = (await claim(s.device.id))!; await updateCommentControl({ action }); expect(await permit(s.device.id, c)).toBeNull();
  });
  it("refuses revoked devices and expired worker lease", async () => {
    const s = await setup(), c = (await claim(s.device.id))!;
    await prisma.lease.update({ where: { name: "worker" }, data: { expiresAt: new Date(0) } }); expect(await permit(s.device.id, c)).toBeNull();
    await prisma.lease.update({ where: { name: "worker" }, data: { expiresAt: new Date(Date.now() + 60000) } });
    await prisma.extensionDevice.update({ where: { id: s.device.id }, data: { revokedAt: new Date() } }); expect(await permit(s.device.id, c)).toBeNull();
  });
  it("cancels a changed rule and refuses stale post revisions", async () => {
    const s = await setup(), c = (await claim(s.device.id))!;
    await prisma.post.update({ where: { id: s.post.id }, data: { textRevision: { increment: 1 } } }); expect(await permit(s.device.id, c)).toBeNull();
    await saveCommentRule({ ...s.input, keywords: "other" }, s.ruleId);
    expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("cancelled");
  });
  it("waits for AI and rechecks ad flags before preparing a job", async () => {
    const s = await setup({ requireAi: true }); expect(s.job.status).toBe("pending_ai"); expect(await claim(s.device.id)).toBeNull();
    await prisma.aiJob.create({ data: { postId: s.post.id, status: "done" } });
    await prisma.post.update({ where: { id: s.post.id }, data: { aiProvider: "gemini:test", isAd: true } });
    await prisma.autoCommentJob.updateMany({ data: { nextAttemptAt: new Date(0) } });
    await prepareBrowserComments(active); expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("cancelled");
  });
  it("uses the AI draft only after completed classification and fences later edits", async () => {
    const s = await setup({ requireAi: true, aiDraft: true });
    await prisma.post.update({ where: { id: s.post.id }, data: { aiProvider: "groq:test", suggestedReply: "ร่างทดสอบ" } });
    await prisma.aiJob.create({ data: { postId: s.post.id, status: "done" } });
    await prisma.autoCommentJob.updateMany({ data: { nextAttemptAt: new Date(0) } }); await prepareBrowserComments(active);
    const c = (await claim(s.device.id))!; expect(c.message).toBe("ร่างทดสอบ");
    await prisma.post.update({ where: { id: s.post.id }, data: { suggestedReply: "ร่างใหม่" } }); expect(await permit(s.device.id, c)).toBeNull();
  });
  it("keeps ambiguous dispatches uncertain across restart and never reoffers them", async () => {
    const s = await setup(), c = (await claim(s.device.id))!; await permit(s.device.id, c);
    await prisma.autoCommentJob.update({ where: { id: c.id }, data: { claimUntil: new Date(0) } }); await prepareBrowserComments(active);
    expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("uncertain");
    await updateCommentControl({ action: "stop" }); await updateCommentControl({ action: "start" });
    await scanBrowserComments(active); expect(await prisma.autoCommentJob.count()).toBe(1); expect(await claim(s.device.id)).toBeNull();
  });
  it("records DOM observation separately and rejects foreign comment URLs", async () => {
    const s = await setup(), c = (await claim(s.device.id))!; await permit(s.device.id, c);
    expect(await reportBrowserComment(s.device.id, c.id, c.claimToken, "observed", "https://www.facebook.com/groups/12345/posts/8888/?comment_id=777")).toBe(true);
    expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("browser_observed");
    expect(await reportBrowserComment(s.device.id, c.id, c.claimToken, "uncertain")).toBe(false);
  });
  it("pauses on checkpoint or uncertain result without retry", async () => {
    const s = await setup(), c = (await claim(s.device.id))!; await permit(s.device.id, c);
    await reportBrowserComment(s.device.id, c.id, c.claimToken, "observed", "https://other.example/?comment_id=1");
    expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("uncertain"); expect((await readCommentControl()).state).toBe("paused");
  });
  it("enforces quota before a second dispatch", async () => {
    const s = await setup(); await updateCommentControl({ hourlyLimit: 1 });
    const c = (await claim(s.device.id))!; await permit(s.device.id, c);
    await reportBrowserComment(s.device.id, c.id, c.claimToken, "observed", "https://www.facebook.com/groups/12345/posts/8888/?comment_id=777");
    await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/9999/", text: "หาช่างด่วน", normalizedText: "หาช่างด่วน", contentHash: `post-${++serial}` } });
    await scanBrowserComments(active); await prepareBrowserComments(active); const next = (await claim(s.device.id))!;
    expect(next).not.toBeNull(); expect(await permit(s.device.id, next)).toBeNull(); expect(await prisma.autoCommentLog.count({ where: { event: "dispatch" } })).toBe(1);
  });
  it("runtime tick does not call Facebook Graph even for old Page rules", async () => {
    const s = await setup(); await prisma.autoCommentRule.update({ where: { id: s.ruleId }, data: { deliveryMode: "official", pageId: "12345" } });
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network"));
    try { await autoCommentTick(active); expect(network).not.toHaveBeenCalled(); } finally { network.mockRestore(); }
  });
  it("encrypts legacy settings on write and restores browser automation stopped", async () => {
    const s = await setup(), c = (await claim(s.device.id))!; await permit(s.device.id, c);
    await prisma.setting.create({ data: { key: "groq_api_key", value: encodeSetting("groq_api_key", "synthetic-test-key") } });
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: "groq_api_key" } })).value).not.toContain("synthetic-test-key");
    const snapshot = JSON.parse(JSON.stringify(await snapshotDatabase(prisma)));
    await expect(restoreDatabase(prisma, snapshot)).rejects.toThrow(/Stop all/);
    await prisma.lease.deleteMany(); await restoreDatabase(prisma, snapshot);
    expect(await readCommentControl()).toMatchObject({ state: "stopped", dryRun: true, emergency: true });
    expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("uncertain");
  });
});
