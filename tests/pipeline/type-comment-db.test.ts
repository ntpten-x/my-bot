import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const helper = process.getBuiltinModule("node:module").createRequire(`${process.cwd()}/package.json`)("./tests/helpers/pg-test-db.cjs");
  return { ...helper.setupTestDatabase("test_type_comment"), drop: helper.dropTestSchema };
});
import { prisma } from "../../src/lib/prisma";
import { autoCommentRuleSchema } from "../../src/lib/auto-comment/schema";
import { saveCommentRule, setCommentRuleEnabled, deleteCommentRule } from "../../src/lib/auto-comment/admin";
import { updateCommentControl, readCommentControl } from "../../src/lib/auto-comment/control";
import { scanBrowserComments, prepareBrowserComments, claimBrowserComment, authorizeBrowserComment } from "../../src/lib/auto-comment/browser";
import { TYPE_SETUP_PREFIX, commentTypeAllowed } from "../../src/lib/auto-comment/type-setup";
beforeAll(() => { if (fixture.enabled) execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { stdio: "pipe" }); }, 180000);
beforeEach(async () => {
  if (!fixture.enabled) return;
  process.env.MYBOT_PROCESS = "worker";
  await prisma.autoCommentLog.deleteMany(); await prisma.autoCommentEvaluation.deleteMany(); await prisma.autoCommentJob.deleteMany(); await prisma.autoCommentTemplate.deleteMany(); await prisma.autoCommentRule.deleteMany();
  await prisma.post.deleteMany(); await prisma.replyTemplate.deleteMany(); await prisma.source.deleteMany(); await prisma.product.deleteMany(); await prisma.category.deleteMany(); await prisma.fbAccount.deleteMany(); await prisma.extensionDevice.deleteMany(); await prisma.setting.deleteMany(); await prisma.lease.deleteMany();
});
afterAll(async () => { if (fixture.enabled) { await fixture.drop(prisma, fixture.schema); await prisma.$disconnect(); } });
async function setup() {
  const category = await prisma.category.create({ data: { name: "เกม", slug: "games" } });
  const product = await prisma.product.create({ data: { name: "Roblox", slug: "roblox", categorySlug: category.slug } });
  const source = await prisma.source.create({ data: { name: "Roblox ทดสอบ", type: "facebook_group", url: "https://www.facebook.com/groups/12345", boundCategorySlug: category.slug, defaultProductId: product.id } });
  const device = await prisma.extensionDevice.create({ data: { name: "Mock Chrome", tokenHash: "synthetic", tokenHint: "mock" } });
  await prisma.fbAccount.create({ data: { id: "99887766" } });
  await prisma.setting.create({ data: { key: `extension_runtime_${device.id}`, value: JSON.stringify({ fbUserId: "99887766", at: new Date().toISOString() }) } });
  const messages = await Promise.all(["ข้อความหนึ่ง", "ข้อความสอง"].map((body, index) => prisma.replyTemplate.create({ data: { name: `ข้อความ ${index}`, body, categoryId: category.id, productId: product.id } })));
  const input = autoCommentRuleSchema.parse({ name: "Roblox", enabled: true, typeProductId: product.id, replyTemplateIds: messages.map(row => row.id), sourceIds: [source.id], selectionMode: "random", deliveryMode: "extension", browserDeviceId: device.id, browserFbUserId: "99887766", browserConsent: true });
  return { category, product, source, device, messages, input };
}
describe.skipIf(!fixture.enabled)("type-specific browser rules in disposable Postgres", () => {
  it("resolves catalog messages server-side, persists scope and leaves global control untouched", async () => {
    const { input, messages, product, source } = await setup();
    const id = await saveCommentRule(input);
    const rule = await prisma.autoCommentRule.findUniqueOrThrow({ where: { id }, include: { templates: { orderBy: { sortOrder: "asc" } } } });
    expect(rule.templates.map(row => row.body)).toEqual(messages.map(row => row.body));
    expect(rule.selectionMode).toBe("random");
    expect(JSON.parse((await prisma.setting.findUniqueOrThrow({ where: { key: `${TYPE_SETUP_PREFIX}${id}` } })).value)).toEqual({ productId: product.id, templateIds: messages.map(row => row.id) });
    expect(await commentTypeAllowed(prisma, id, source)).toBe(true);
    expect(await prisma.autoCommentJob.count()).toBe(0);
  });
  it("rejects groups and messages outside the selected type without leaving a partial rule", async () => {
    const { input, source, messages } = await setup();
    await prisma.source.update({ where: { id: source.id }, data: { defaultProductId: null } });
    await expect(saveCommentRule(input)).rejects.toThrow("กลุ่มต้องอยู่");
    expect(await prisma.autoCommentRule.count()).toBe(0);
    await prisma.source.update({ where: { id: source.id }, data: { defaultProductId: input.typeProductId } });
    await prisma.replyTemplate.update({ where: { id: messages[0].id }, data: { sourceIds: "some-other-group" } });
    await expect(saveCommentRule(input)).rejects.toThrow("ข้อความต้องใช้");
    expect(await prisma.autoCommentRule.count()).toBe(0);
  });
  it("stores the enabled preference while an owner-paused account still blocks delivery", async () => {
    const { input } = await setup();
    await prisma.setting.create({ data: { key: "facebook_account_paused_99887766", value: "1" } });
    const id = await saveCommentRule(input);
    expect((await prisma.autoCommentRule.findUniqueOrThrow({ where: { id } })).enabled).toBe(true);
    const { facebookWorkAllowed } = await import("../../src/lib/facebook-accounts");
    expect(await facebookWorkAllowed(new Request("http://localhost"), "99887766")).toBe(false);
  });
  it("prepares only selected text and denies a claimed job after its group changes type", async () => {
    const { input, source, device, messages } = await setup();
    await saveCommentRule(input);
    await updateCommentControl({ dryRun: false, liveAcknowledged: true }); await updateCommentControl({ action: "start" });
    await prisma.lease.create({ data: { name: "worker", holder: "synthetic", expiresAt: new Date(Date.now() + 150000) } });
    await prisma.post.create({ data: { sourceId: source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/8888/", text: "โพสต์ทดสอบ Roblox", normalizedText: "โพสต์ทดสอบ Roblox", contentHash: "synthetic" } });
    await scanBrowserComments(async () => undefined); await prepareBrowserComments(async () => undefined);
    const job = await claimBrowserComment(device.id, "99887766");
    expect(job).not.toBeNull(); expect(messages.map(row => row.body)).toContain(job!.message);
    await prisma.source.update({ where: { id: source.id }, data: { defaultProductId: null } });
    expect(await authorizeBrowserComment(device.id, job!.id, job!.claimToken, "99887766")).toBeNull();
    expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe("cancelled");
    expect(await prisma.autoCommentLog.count({ where: { event: "dispatch" } })).toBe(0);
  });
});

describe.skipIf(!fixture.enabled)("draft configuration before extension installation", () => {
  it("persists an unbound draft and binds it later without losing the original settings", async () => {
    const { input, device } = await setup();
    await prisma.extensionDevice.delete({ where: { id: device.id } });
    await prisma.fbAccount.deleteMany();
    await prisma.setting.deleteMany();
    const draft = autoCommentRuleSchema.parse({ ...input, enabled: false, browserDeviceId: "", browserFbUserId: "", browserConsent: false, startMinute: 0, endMinute: 1440, areaCooldownSec: 60 });
    const id = await saveCommentRule(draft);
    const saved = await prisma.autoCommentRule.findUniqueOrThrow({ where: { id } });
    expect(saved).toMatchObject({ enabled: false, browserDeviceId: "", browserFbUserId: "", browserConsent: false, startMinute: 0, endMinute: 1440, areaCooldownSec: 60 });
    expect(await prisma.autoCommentJob.count()).toBe(0);
    expect(autoCommentRuleSchema.safeParse({ ...draft, enabled: true }).success).toBe(true);
    expect(autoCommentRuleSchema.safeParse({ ...draft, enabled: true, browserConsent: true }).success).toBe(false);
    const newDevice = await prisma.extensionDevice.create({ data: { name: "ติดตั้งภายหลัง", tokenHash: "later-synthetic", tokenHint: "mock" } });
    await prisma.fbAccount.create({ data: { id: "99887766" } });
    await prisma.setting.create({ data: { key: `extension_runtime_${newDevice.id}`, value: JSON.stringify({ fbUserId: "99887766", at: new Date().toISOString() }) } });
    await saveCommentRule(autoCommentRuleSchema.parse({ ...draft, enabled: true, browserDeviceId: newDevice.id, browserFbUserId: "99887766", browserConsent: true }), id);
    const bound = await prisma.autoCommentRule.findUniqueOrThrow({ where: { id }, include: { templates: true } });
    expect(bound).toMatchObject({ enabled: true, browserDeviceId: newDevice.id, browserFbUserId: "99887766", startMinute: 0, endMinute: 1440, areaCooldownSec: 60, revision: saved.revision + 1 });
    expect(bound.templates).toHaveLength(2);
    expect(await prisma.autoCommentJob.count()).toBe(0);
  });
});

describe.skipIf(!fixture.enabled)("per-type saved list switches", () => {
  it("toggles only the saved rule, preserves its message snapshots and fences claimed work", async () => {
    const { input, messages, device, source } = await setup();
    const id = await saveCommentRule(input);
    const before = await prisma.autoCommentRule.findUniqueOrThrow({ where: { id }, include: { templates: true } });
    await updateCommentControl({ action: "start" });
    await prisma.post.create({ data: { sourceId: source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/998811/", text: "ทดสอบ Roblox", normalizedText: "ทดสอบ Roblox", contentHash: "toggle-test" } });
    await scanBrowserComments(async () => undefined); await prepareBrowserComments(async () => undefined);
    const job = await claimBrowserComment(device.id, "99887766"); expect(job).not.toBeNull();
    const global = await readCommentControl();
    const off = await setCommentRuleEnabled(id, false, before.revision);
    expect(off.enabled).toBe(false);
    expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe("cancelled");
    expect(await authorizeBrowserComment(device.id, job!.id, job!.claimToken, "99887766")).toBeNull();
    await prisma.replyTemplate.update({ where: { id: messages[0].id }, data: { body: "ต้นฉบับแก้แล้ว แต่สวิตช์ไม่ควรเปลี่ยนสำเนา" } });
    const on = await setCommentRuleEnabled(id, true, off.revision);
    const after = await prisma.autoCommentRule.findUniqueOrThrow({ where: { id }, include: { templates: true } });
    expect(on.enabled).toBe(true); expect(after.templates).toEqual(before.templates);
    expect(after).toMatchObject({ startMinute: before.startMinute, endMinute: before.endMinute, sourceIdsJson: before.sourceIdsJson, browserDeviceId: before.browserDeviceId });
    expect(await readCommentControl()).toEqual(global);
  });
  it("rejects stale switches but lets unbound drafts store an enabled preference", async () => {
    const { input } = await setup();
    const id = await saveCommentRule(autoCommentRuleSchema.parse({ ...input, enabled: false, browserDeviceId: "", browserFbUserId: "", browserConsent: false }));
    const before = await prisma.autoCommentRule.findUniqueOrThrow({ where: { id } });
    await expect(setCommentRuleEnabled(id, true, before.revision + 1)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.autoCommentRule.findUniqueOrThrow({ where: { id } })).toEqual(before);
    await setCommentRuleEnabled(id, true, before.revision);
    await updateCommentControl({ action: "start" });
    await scanBrowserComments(async () => undefined);
    expect((await prisma.autoCommentRule.findUniqueOrThrow({ where: { id } })).enabled).toBe(true);
    expect(await prisma.autoCommentJob.count()).toBe(0);
  });
  it("supplies the saved type and category labels in the dashboard", async () => {
    const { input } = await setup(); const id = await saveCommentRule(input);
    const { autoCommentDashboard } = await import("../../src/lib/auto-comment/engine");
    const dashboard = await autoCommentDashboard();
    expect(dashboard.rules.find(rule => rule.id === id)?.typeInfo).toMatchObject({ name: "Roblox", categoryName: "เกม" });
  });
});

describe.skipIf(!fixture.enabled)("deleting saved comment sets", () => {
  it("removes the list entry, cancels unsent work, preserves sending history and prevents reopening", async () => {
    const { input, source } = await setup(); const id = await saveCommentRule(input);
    await updateCommentControl({ action: "start" });
    await prisma.post.create({ data: { sourceId: source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/774411/", text: "Roblox", normalizedText: "Roblox", contentHash: "delete-test" } });
    await scanBrowserComments(async () => undefined); await prepareBrowserComments(async () => undefined);
    const job = await prisma.autoCommentJob.findFirstOrThrow();
    const sending = await prisma.autoCommentJob.create({ data: { ...job, id: undefined, dedupeKey: "preserved-sending", status: "sending", claimToken: "synthetic", dispatchedAt: new Date(), postId: null } });
    const control = await readCommentControl();
    const revision = (await prisma.autoCommentRule.findUniqueOrThrow({ where: { id } })).revision;
    await deleteCommentRule(id, revision);
    expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled");
    expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: sending.id } })).status).toBe("sending");
    expect(await prisma.autoCommentTemplate.count({ where: { ruleId: id } })).toBe(2);
    const { autoCommentDashboard } = await import("../../src/lib/auto-comment/engine");
    expect((await autoCommentDashboard()).rules.some(rule => rule.id === id)).toBe(false);
    await expect(setCommentRuleEnabled(id, true, revision + 1)).rejects.toMatchObject({ status: 404 });
    await expect(saveCommentRule(input, id)).rejects.toThrow("ถูกลบแล้ว");
    expect(await deleteCommentRule(id, revision)).toEqual({ ok: true });
    expect(await readCommentControl()).toEqual(control);
  });
});

describe.skipIf(!fixture.enabled)("archived list capacity", () => {
  it("does not count deleted sets toward the active set limit", async () => {
    const { input } = await setup();
    await prisma.autoCommentRule.createMany({ data: Array.from({ length: 30 }, (_, index) => ({ name: `synthetic ${index}` })) });
    await expect(saveCommentRule(input)).rejects.toThrow("สูงสุด 30");
    const first = await prisma.autoCommentRule.findFirstOrThrow();
    await deleteCommentRule(first.id, first.revision);
    const created = await saveCommentRule(input); expect(created).toBeTruthy();
    const { autoCommentDashboard } = await import("../../src/lib/auto-comment/engine");
    expect((await autoCommentDashboard()).rules).toHaveLength(30);
  });
});
