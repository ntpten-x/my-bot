import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const helper = process.getBuiltinModule("node:module").createRequire(`${process.cwd()}/package.json`)("./tests/helpers/pg-test-db.cjs");
  return { ...helper.setupTestDatabase("test_comment_fairness"), drop: helper.dropTestSchema };
});
import { prisma } from "../../src/lib/prisma";
import { defaultControl } from "../../src/lib/auto-comment/control";
import { claimBrowserComment, prepareBrowserComments } from "../../src/lib/auto-comment/browser";

beforeAll(() => {
  if (fixture.enabled) execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { stdio: "pipe" });
}, 180000);
beforeEach(async () => {
  if (!fixture.enabled) return;
  vi.stubEnv("MYBOT_PROCESS", "worker");
  await prisma.autoCommentLog.deleteMany();
  await prisma.autoCommentJob.deleteMany();
  await prisma.autoCommentRule.deleteMany();
  await prisma.post.deleteMany();
  await prisma.source.deleteMany();
  await prisma.extensionDevice.deleteMany();
  await prisma.setting.deleteMany();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  if (fixture.enabled) { await fixture.drop(prisma, fixture.schema); await prisma.$disconnect(); }
});

async function queueFixture(status: "browser_ready" | "pending_ai") {
  const source = await prisma.source.create({ data: { name: "synthetic group", type: "facebook_group", url: "https://www.facebook.com/groups/12345" } });
  const device = await prisma.extensionDevice.create({ data: { name: "synthetic device", tokenHash: "synthetic-fairness-token-hash", tokenHint: "test" } });
  await prisma.setting.create({ data: { key: "auto_comment_control", value: JSON.stringify({ ...defaultControl, state: "running", generation: "synthetic-fairness", startedAt: new Date(Date.now() - 60000).toISOString() }) } });
  const post = await prisma.post.create({ data: {
    sourceId: source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/8888/",
    text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: "synthetic-fairness-post",
  } });
  const ruleData = {
    name: "synthetic rule", enabled: true, deliveryMode: "extension", messageMode: "template",
    browserConsent: true, browserDeviceId: device.id, browserFbUserId: "99887766",
    sourceIdsJson: JSON.stringify([source.id]), keywords: "หาช่าง", areaCooldownSec: 0,
  };
  const activeRule = await prisma.autoCommentRule.create({ data: ruleData });
  const pausedRule = await prisma.autoCommentRule.create({ data: { ...ruleData, pausedReason: "synthetic checkpoint awaiting owner review" } });
  const disabledRule = await prisma.autoCommentRule.create({ data: { ...ruleData, enabled: false } });
  const jobData = {
    postId: post.id, sourceId: source.id, externalUrl: post.externalUrl, postKey: "group:12345:8888", pageId: "group:12345",
    deliveryMode: "extension", browserDeviceId: device.id, browserFbUserId: "99887766",
    ruleRevision: 1, textRevision: 0, generation: "synthetic-fairness", dryRun: false,
    message: "ข้อความสังเคราะห์สำหรับทดสอบเท่านั้น", status, nextAttemptAt: new Date(Date.now() - 1000),
  };
  // More parked rows than either bounded page; the active job must not wait for them to change.
  await prisma.autoCommentJob.createMany({ data: Array.from({ length: 60 }, (_, index) => ({
    ...jobData, ruleId: index % 2 ? disabledRule.id : pausedRule.id,
    dedupeKey: `synthetic-parked-${index}`, createdAt: new Date(Date.now() - 120000 + index),
  })) });
  const active = await prisma.autoCommentJob.create({ data: { ...jobData, ruleId: activeRule.id, dedupeKey: "synthetic-active" } });
  return { device, active, pausedRule, disabledRule };
}

describe.skipIf(!fixture.enabled)("comment queue fairness on disposable Postgres", () => {
  it("claims an active rule behind a full page of parked and disabled jobs without altering them", async () => {
    const { device, active, pausedRule, disabledRule } = await queueFixture("browser_ready");
    const claim = await claimBrowserComment(device.id, "99887766");
    expect(claim?.id).toBe(active.id);
    expect(await prisma.autoCommentJob.count({ where: { ruleId: { in: [pausedRule.id, disabledRule.id] }, status: "browser_ready", attempts: 0, dispatchedAt: null, claimToken: null } })).toBe(60);
    expect(await prisma.autoCommentLog.count({ where: { event: "dispatch" } })).toBe(0);
  });

  it("prepares an active rule behind a full page of parked jobs while preserving their durable queue", async () => {
    const { active, pausedRule, disabledRule } = await queueFixture("pending_ai");
    await prepareBrowserComments(async () => undefined, { deadlineMs: Date.now() + 10000 });
    expect(await prisma.autoCommentJob.findUnique({ where: { id: active.id } })).toMatchObject({ status: "browser_ready", attempts: 0, dispatchedAt: null });
    expect(await prisma.autoCommentJob.count({ where: { ruleId: { in: [pausedRule.id, disabledRule.id] }, status: "pending_ai", attempts: 0, dispatchedAt: null, claimToken: null } })).toBe(60);
  });
});
