import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
    const helper = process.getBuiltinModule("node:module").createRequire(`${process.cwd()}/package.json`)("./tests/helpers/pg-test-db.cjs");
    return { ...helper.setupTestDatabase("test_browser_comment"), drop: helper.dropTestSchema };
});
vi.mock("../../src/lib/auto-comment/draft", async (importOriginal) => {
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
import { collectObservation, observationOptions } from "../../scripts/observe-automation.mjs";
import { EXPECTED_EXTENSION_VERSION, heartbeatSchema, recordHeartbeat } from "../../src/lib/extension-heartbeat";
import { isIncompleteScrape } from "../../src/lib/scrape-plan";
import { postStreamWhere, type PostStreamCursor } from "../../src/lib/post-stream";
let serial = 0;
const active = async () => undefined;
beforeAll(() => { if (fixture.enabled)
    execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { stdio: "pipe" }); }, 180000);
beforeEach(async () => {
    if (!fixture.enabled)
        return;
    process.env.MYBOT_PROCESS = "worker";
    process.env.AI_KEY_SECRET = "synthetic-browser-comment-test-key-only";
    await prisma.autoCommentLog.deleteMany();
    await prisma.autoCommentJob.deleteMany();
    await prisma.autoCommentTemplate.deleteMany();
    await prisma.autoCommentRule.deleteMany();
    await prisma.aiJob.deleteMany();
    await prisma.post.deleteMany();
    await prisma.source.deleteMany();
    await prisma.extensionDevice.deleteMany();
    await prisma.setting.deleteMany();
    await prisma.lease.deleteMany();
    await prisma.extensionHeartbeat.deleteMany();
});
afterAll(async () => { if (fixture.enabled) {
    await fixture.drop(prisma, fixture.schema);
    await prisma.$disconnect();
} });
async function setup(options: {
    dry?: boolean;
    requireAi?: boolean;
    aiDraft?: boolean;
} = {}) {
    const device = await prisma.extensionDevice.create({ data: { name: "mock Chrome", tokenHash: `mock-${++serial}`, tokenHint: "mock" } });
    const source = await prisma.source.create({ data: { name: "synthetic group", type: "facebook_group", url: "https://www.facebook.com/groups/12345" } });
    const input = autoCommentRuleSchema.parse({ name: "ทดสอบ", enabled: true, deliveryMode: "extension", sourceIds: [source.id], templates: ["ข้อความทดสอบ"], keywords: "หาช่าง", browserDeviceId: device.id, browserFbUserId: "99887766", browserConsent: true, requireAi: false, messageMode: "template" });
    const ruleId = await saveCommentRule(input);
    await updateCommentControl({ dryRun: options.dry ?? false, liveAcknowledged: true });
    await updateCommentControl({ action: "start" });
    await prisma.lease.create({ data: { name: "worker", holder: "synthetic", expiresAt: new Date(Date.now() + 150000) } });
    if (options.requireAi)
        await prisma.autoCommentRule.update({ where: { id: ruleId }, data: { requireAi: true } });
    const post = await prisma.post.create({ data: { sourceId: source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/8888/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `post-${++serial}` } });
    await scanBrowserComments(active);
    await prepareBrowserComments(active);
    return { device, source, ruleId, input, post, job: await prisma.autoCommentJob.findFirstOrThrow() };
}
const claim = (deviceId: string) => claimBrowserComment(deviceId, "99887766");
it.skipIf(!fixture.enabled)("uses the configured post age for newly captured posts published before Start", async () => {
    const s = await setup();
    const post = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/9991/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `age-${++serial}`, postedAt: new Date(Date.now() - 3600000) } });
    await scanBrowserComments(active);
    expect(await prisma.autoCommentJob.findFirst({ where: { postId: post.id } })).toMatchObject({ status: "browser_ready", attempts: 0 });
    const olderCapture = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/9992/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `age-${++serial}`, postedAt: new Date(Date.now() - 3600000), createdAt: new Date(Date.now() - 7200000) } });
    await scanBrowserComments(active);
    expect(await prisma.autoCommentJob.count({ where: { postId: olderCapture.id } })).toBe(0);
});
const permit = (deviceId: string, job: {
    id: string;
    claimToken: string;
}) => authorizeBrowserComment(deviceId, job.id, job.claimToken, "99887766");
describe.skipIf(!fixture.enabled)("browser comment durable workflow on disposable Postgres", () => {
    it("makes freshly prepared jobs due using the same clock as their evaluation", async () => {
        const s = await setup({ dry: true });
        await prisma.$executeRawUnsafe('ALTER TABLE "AutoCommentJob" ALTER COLUMN "nextAttemptAt" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL \'1 minute\')');
        try {
            const post = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/90009/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: "synthetic-default-clock" } });
            await scanBrowserComments(active);
            await prepareBrowserComments(active);
            expect(await prisma.autoCommentJob.findFirst({ where: { postId: post.id } })).toMatchObject({ status: "dry_run" });
        } finally {
            await prisma.$executeRawUnsafe('ALTER TABLE "AutoCommentJob" ALTER COLUMN "nextAttemptAt" SET DEFAULT CURRENT_TIMESTAMP');
        }
    });
    it("does not claim partially processed posts and reevaluates after rule work completes", async () => {
        const s = await setup();
        await prisma.post.update({ where: { id: s.post.id }, data: { processingState: "pending_edit" } });
        expect(await claim(s.device.id)).toBeNull();
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: s.job.id } })).toMatchObject({ status: "cancelled" });
        await scanBrowserComments(active);
        expect(await claim(s.device.id)).toBeNull();
        await prisma.post.update({ where: { id: s.post.id }, data: { processingState: "done" } });
        await scanBrowserComments(active);
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: s.job.id } })).toMatchObject({ status: "browser_ready", attempts: 0, dispatchedAt: null });
    });
    it("upgrades legacy AI configuration while preserving a sending marker and owner control", async () => {
        const s = await setup();
        const claimed = (await claim(s.device.id))!;
        await permit(s.device.id, claimed);
        const sending = await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: s.job.id } });
        const control = await readCommentControl();
        await prisma.autoCommentRule.update({ where: { id: s.ruleId }, data: { requireAi: true } });
        const draft = await prisma.autoCommentRule.create({ data: { name: "historical generated rule", messageMode: "ai_draft", enabled: true } });
        const pending = await prisma.autoCommentJob.create({ data: { ...s.job, id: undefined, ruleId: draft.id, dedupeKey: "synthetic-retired-draft", postKey: "synthetic-retired-draft", status: "pending_ai" } });
        const provider = await prisma.aiProvider.create({ data: { name: "historical provider" } });
        await prisma.aiJob.create({ data: { postId: s.post.id, status: "pending" } });
        const sql = readFileSync("prisma/migrations/20261130090000_rules_only_bot/migration.sql", "utf8");
        await prisma.$transaction(async tx => {
            for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
        });
        expect(await readCommentControl()).toEqual(control);
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: sending.id } })).toEqual(sending);
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "cancelled" });
        expect(await prisma.autoCommentRule.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ enabled: false });
        expect(await prisma.autoCommentRule.findUniqueOrThrow({ where: { id: s.ruleId } })).toMatchObject({ requireAi: false });
        expect(await prisma.aiJob.findUniqueOrThrow({ where: { postId: s.post.id } })).toMatchObject({ status: "skipped", claimToken: null });
        expect(await prisma.aiProvider.findUniqueOrThrow({ where: { id: provider.id } })).toMatchObject({ enabled: false });
        await prisma.aiProvider.delete({ where: { id: provider.id } });
    });
    it("reconsiders a skipped numeric post when the configured group learns its numeric alias", async () => {
        const s = await setup();
        const aliasPost = await prisma.post.create({ data: { sourceId: s.source.id,
                externalUrl: "https://www.facebook.com/groups/998811/posts/8889/", text: "หาช่างแอร์",
                normalizedText: "หาช่างแอร์", contentHash: `alias-${++serial}` } });
        await scanBrowserComments(active);
        expect(await prisma.autoCommentJob.findFirst({ where: { postId: aliasPost.id } })).toBeNull();
        await prisma.source.update({ where: { id: s.source.id }, data: { fbGroupId: "998811" } });
        await scanBrowserComments(active);
        expect(await prisma.autoCommentJob.findFirst({ where: { postId: aliasPost.id } })).toMatchObject({ status: "browser_ready" });
    });
    it("loads template bodies once per scan and still rotates templates for each post", async () => {
        const s = await setup({ dry: true });
        await saveCommentRule({ ...s.input, selectionMode: "sequential", templates: ["first", "second"] }, s.ruleId);
        await prisma.autoCommentRule.update({ where: { id: s.ruleId }, data: { nextTemplate: 0 } });
        await prisma.post.createMany({ data: Array.from({ length: 6 }, (_, index) => ({ sourceId: s.source.id,
                externalUrl: `https://www.facebook.com/groups/12345/posts/${8100 + index}/`,
                text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `rotation-${++serial}` })) });
        let templateLoads = 0, manifests = 0;
        const original = prisma.$transaction;
        // Forward to real disposable Postgres. Count only the query payload, never mock results.
        prisma.$transaction = (async (work, ...args) => original.call(prisma, async (tx) => work(new Proxy(tx, {
            get(target, property) {
                if (property !== "autoCommentRule")
                    return Reflect.get(target, property);
                return new Proxy(target.autoCommentRule, { get(model, method) {
                        if (method !== "findMany")
                            return Reflect.get(model, method);
                        return query => {
                            if (query.include?.templates)
                                templateLoads++;
                            if (query.select?.revision)
                                manifests++;
                            return model.findMany(query);
                        };
                    } });
            },
        })), ...args)) as typeof prisma.$transaction;
        try {
            await scanBrowserComments(active);
        }
        finally {
            prisma.$transaction = original;
        }
        const jobs = await prisma.autoCommentJob.findMany({ where: { postId: { not: s.post.id } }, orderBy: { externalUrl: "asc" } });
        expect(jobs.map(job => job.message)).toEqual(["first", "second", "first", "second", "first", "second"]);
        expect(templateLoads).toBe(0); // Initial snapshot is loaded outside these per-post transactions.
        expect(manifests).toBeGreaterThanOrEqual(6);
    });
    it("refreshes a scan snapshot when consent or templates change between posts", async () => {
        const s = await setup({ dry: true });
        const makePost = (id: number) => prisma.post.create({ data: { sourceId: s.source.id,
                externalUrl: `https://www.facebook.com/groups/12345/posts/${id}/`, text: "หาช่างแอร์",
                normalizedText: "หาช่างแอร์", contentHash: `snapshot-${++serial}` } });
        const a = await makePost(8201), b = await makePost(8202), c = await makePost(8203);
        let calls = 0;
        await scanBrowserComments(async () => {
            calls++;
            // The first assertion fences the initial snapshot; subsequent assertions fence each post.
            if (calls === 3)
                await saveCommentRule({ ...s.input, templates: ["updated"] }, s.ruleId);
            if (calls === 4)
                await saveCommentRule({ ...s.input, browserConsent: false }, s.ruleId);
        });
        expect(await prisma.autoCommentJob.findFirst({ where: { postId: a.id } })).toMatchObject({ message: "ข้อความทดสอบ" });
        expect(await prisma.autoCommentJob.findFirst({ where: { postId: b.id } })).toMatchObject({ message: "updated" });
        expect(await prisma.autoCommentJob.count({ where: { postId: c.id } })).toBe(0);
        await prepareBrowserComments(active);
        expect(await claim(s.device.id)).toBeNull();
    });
    it("records rejected posts and revisits owner changes without a createdAt change", async () => {
        const s = await setup({ dry: true, requireAi: true });
        const post = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/4444/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `post-${++serial}`, isAd: true } });
        await scanBrowserComments(active);
        expect(await prisma.autoCommentJob.count({ where: { postId: post.id } })).toBe(0);
        expect(await prisma.autoCommentEvaluation.findFirst({ where: { postId: post.id } })).toMatchObject({ state: "skipped" });
        await prisma.aiJob.create({ data: { postId: post.id, status: "done" } });
        await prisma.post.update({ where: { id: post.id }, data: { isAd: false, aiProvider: "gemini:mock", intent: "buyer" } });
        await scanBrowserComments(active);
        await prepareBrowserComments(active);
        expect(await prisma.autoCommentJob.findFirst({ where: { postId: post.id } })).toMatchObject({ status: "dry_run", message: "ข้อความทดสอบ" });
        await scanBrowserComments(active);
        await scanBrowserComments(active);
        expect(await prisma.autoCommentJob.count({ where: { postId: post.id } })).toBe(1);
        expect(await prisma.autoCommentEvaluation.count({ where: { postId: post.id } })).toBe(1);
    });
    it("sends a configured shoe template only to buyer intent in Dry Run", async () => {
        const s = await setup({ dry: true });
        await saveCommentRule({ ...s.input, keywords: "รองเท้า", intentMode: "buyer", templates: ["แนะนำร้าน https://shopee.co.th/example"] }, s.ruleId);
        for (const [id, text] of [["1111", "หารองเท้าวิ่ง"], ["2222", "ขายรองเท้า"], ["3333", "ได้รองเท้าแล้ว"]]) {
            await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: `https://www.facebook.com/groups/12345/posts/${id}/`, text, normalizedText: text, contentHash: `post-${++serial}` } });
        }
        await scanBrowserComments(active);
        await prepareBrowserComments(active);
        const shoes = await prisma.autoCommentJob.findMany({ where: { message: { contains: "shopee" } } });
        expect(shoes).toHaveLength(1);
        expect(shoes[0]).toMatchObject({ status: "dry_run", externalUrl: "https://www.facebook.com/groups/12345/posts/1111/" });
        expect(await prisma.autoCommentEvaluation.count({ where: { state: "skipped" } })).toBeGreaterThanOrEqual(2);
        expect(await claim(s.device.id)).toBeNull();
    });
    it("repairs missing evaluations across batches without replaying deliveries", async () => {
        const s = await setup({ dry: true });
        await prisma.post.createMany({ data: Array.from({ length: 105 }, (_, index) => ({ sourceId: s.source.id, externalUrl: `https://www.facebook.com/groups/12345/posts/${5000 + index}/`, text: "ไม่ตรงกฎ", normalizedText: "ไม่ตรงกฎ", contentHash: `batch-${++serial}` })) });
        await scanBrowserComments(active);
        await scanBrowserComments(active);
        expect(await prisma.autoCommentEvaluation.count()).toBe(106);
        await prisma.autoCommentEvaluation.deleteMany({ where: { postId: s.post.id } });
        await scanBrowserComments(active);
        expect(await prisma.autoCommentEvaluation.count()).toBe(106);
        expect(await prisma.autoCommentJob.count()).toBe(1);
        await prisma.autoCommentEvaluation.updateMany({ data: { nextEvaluateAt: new Date(0) } });
        const fresh = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/9000/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `post-${++serial}` } });
        await scanBrowserComments(active);
        expect(await prisma.autoCommentEvaluation.findFirst({ where: { postId: fresh.id } })).not.toBeNull();
    });
    it("revisits text revisions and re-arms only never-dispatched cancelled jobs", async () => {
        const s = await setup({ requireAi: true });
        await prisma.autoCommentJob.updateMany({ data: { status: "pending_ai" } });
        await prisma.post.update({ where: { id: s.post.id }, data: { textRevision: { increment: 1 }, text: "หาช่างแอร์ด่วน", aiProvider: "owner", intent: "buyer" } });
        await prisma.autoCommentJob.updateMany({ data: { nextAttemptAt: new Date(0) } });
        await prepareBrowserComments(active);
        expect(await prisma.autoCommentJob.findFirst()).toMatchObject({ status: "cancelled" });
        await scanBrowserComments(active);
        await prepareBrowserComments(active);
        expect(await prisma.autoCommentJob.findFirst()).toMatchObject({ id: s.job.id, textRevision: 1, status: "browser_ready" });
        const c = (await claim(s.device.id))!;
        await permit(s.device.id, c);
        await reportBrowserComment(s.device.id, c.id, c.claimToken, "uncertain");
        await prisma.post.update({ where: { id: s.post.id }, data: { textRevision: { increment: 1 } } });
        expect(await claim(s.device.id)).toBeNull();
        expect(await prisma.autoCommentJob.findFirst()).toMatchObject({ status: "uncertain", attempts: 1 });
    });
    it("prefers explicit rule priority and keeps evaluation table under RLS and backup", async () => {
        const s = await setup({ dry: true });
        await saveCommentRule({ ...s.input, name: "priority", priority: 100, templates: ["สำคัญก่อน"] });
        const post = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/6666/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `post-${++serial}` } });
        await scanBrowserComments(active);
        await prepareBrowserComments(active);
        expect(await prisma.autoCommentJob.findFirst({ where: { postId: post.id } })).toMatchObject({ message: "สำคัญก่อน" });
        const rows = await prisma.$queryRaw<{
            relrowsecurity: boolean;
        }[]> `SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${fixture.schema} AND c.relname='AutoCommentEvaluation'`;
        expect(rows).toEqual([{ relrowsecurity: true }]);
        expect((await snapshotDatabase(prisma)).tables.AutoCommentEvaluation.length).toBeGreaterThan(0);
    });
    it("uses deterministic intent and priority even with stale AI labels", async () => { const s = await setup({ dry: true }); await saveCommentRule({ ...s.input, name: "buyer priority", keywords: "รองเท้า", priority: 100, intentMode: "buyer", templates: ["buyer template"] }); await saveCommentRule({ ...s.input, name: "fallback", keywords: "รองเท้า", templates: ["fallback"] }); const post = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/7777/", text: "หารองเท้าวิ่ง", normalizedText: "หารองเท้าวิ่ง", contentHash: "local-intent", intent: "seller", aiProvider: "gemini:old" } }); await scanBrowserComments(active); await prepareBrowserComments(active); expect(await prisma.autoCommentJob.findMany({ where: { postId: post.id } })).toMatchObject([{ message: "buyer template", status: "dry_run" }]); });
    it("rechecks disabled sources and scheduled checkpoints without creating duplicates", async () => {
        const s = await setup({ dry: true });
        await prisma.source.update({ where: { id: s.source.id }, data: { enabled: false } });
        const post = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/7778/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `post-${++serial}` } });
        await scanBrowserComments(active);
        expect(await prisma.autoCommentJob.count({ where: { postId: post.id } })).toBe(0);
        await prisma.source.update({ where: { id: s.source.id }, data: { enabled: true } });
        await scanBrowserComments(active);
        await prepareBrowserComments(active);
        await prisma.autoCommentEvaluation.updateMany({ where: { postId: post.id }, data: { state: "waiting_window", nextEvaluateAt: new Date(0) } });
        await scanBrowserComments(active);
        expect(await prisma.autoCommentEvaluation.findFirst({ where: { postId: post.id } })).toMatchObject({ nextEvaluateAt: null, state: "deduplicated" });
        expect(await prisma.autoCommentJob.count({ where: { postId: post.id } })).toBe(1);
    });
    it("denies evaluation reads and changes to an unprivileged database role", async () => {
        await setup({ dry: true });
        const role = `${fixture.schema}_anon`;
        await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`);
            await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${fixture.schema}" TO "${role}"`);
            await tx.$executeRawUnsafe(`GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA "${fixture.schema}" TO "${role}"`);
            await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
            expect(await tx.$queryRawUnsafe(`SELECT * FROM "${fixture.schema}"."AutoCommentEvaluation"`)).toEqual([]);
            expect(await tx.$executeRawUnsafe(`UPDATE "${fixture.schema}"."AutoCommentEvaluation" SET state='matched'`)).toBe(0);
            await tx.$executeRawUnsafe("RESET ROLE");
            await tx.$executeRawUnsafe(`DROP OWNED BY "${role}"`);
            await tx.$executeRawUnsafe(`DROP ROLE "${role}"`);
        });
    });
    it("does not create jobs in a web process", async () => {
        const s = await setup();
        await prisma.autoCommentJob.deleteMany();
        process.env.MYBOT_PROCESS = "web";
        await scanBrowserComments(active);
        expect(await prisma.autoCommentJob.count()).toBe(0);
        expect(await claim(s.device.id)).toBeNull();
    });
    it("never offers Dry Run jobs to a browser", async () => {
        const s = await setup({ dry: true });
        expect(s.job.status).toBe("dry_run");
        expect(await claim(s.device.id)).toBeNull();
    });
    it("fences wrong devices, accounts and duplicate claims", async () => {
        const s = await setup();
        expect(await claim("other-device")).toBeNull();
        expect(await claimBrowserComment(s.device.id, "11111111")).toBeNull();
        const results = await Promise.all([claim(s.device.id), claim(s.device.id)]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await claim(s.device.id)).toBeNull();
    });
    it("commits sending and dispatch before issuing a single-use grant", async () => {
        const s = await setup(), c = (await claim(s.device.id))!;
        expect(await permit(s.device.id, c)).toMatchObject({ ttlMs: 3000 });
        expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("sending");
        expect(await prisma.autoCommentLog.count({ where: { event: "dispatch" } })).toBe(1);
        expect(await permit(s.device.id, c)).toBeNull();
    });
    it.each(["stop", "emergency", "pause"] as const)("refuses authorization after %s", async (action) => {
        const s = await setup(), c = (await claim(s.device.id))!;
        await updateCommentControl({ action });
        expect(await permit(s.device.id, c)).toBeNull();
    });
    it("refuses revoked devices and expired worker lease", async () => {
        const s = await setup(), c = (await claim(s.device.id))!;
        await prisma.lease.update({ where: { name: "worker" }, data: { expiresAt: new Date(0) } });
        expect(await permit(s.device.id, c)).toBeNull();
        await prisma.lease.update({ where: { name: "worker" }, data: { expiresAt: new Date(Date.now() + 60000) } });
        await prisma.extensionDevice.update({ where: { id: s.device.id }, data: { revokedAt: new Date() } });
        expect(await permit(s.device.id, c)).toBeNull();
    });
    it("cancels a changed rule and refuses stale post revisions", async () => {
        const s = await setup(), c = (await claim(s.device.id))!;
        await prisma.post.update({ where: { id: s.post.id }, data: { textRevision: { increment: 1 } } });
        expect(await permit(s.device.id, c)).toBeNull();
        await saveCommentRule({ ...s.input, keywords: "other" }, s.ruleId);
        expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("cancelled");
    });
    it("queues without AI but still rejects a new ad flag before authorize", async () => { const s = await setup({ requireAi: true }); expect(s.job.status).toBe("browser_ready"); expect(await prisma.aiJob.count()).toBe(0); const c = (await claim(s.device.id))!; await prisma.post.update({ where: { id: s.post.id }, data: { isAd: true } }); expect(await permit(s.device.id, c)).toBeNull(); expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("cancelled"); });
    it("refuses a legacy generated-message rule without opening a provider", async () => { const s = await setup(); await prisma.autoCommentRule.update({ where: { id: s.ruleId }, data: { messageMode: "ai_draft" } }); await prisma.autoCommentJob.update({ where: { id: s.job.id }, data: { status: "pending_ai" } }); const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network")); try {
        await prepareBrowserComments(active);
        expect(await claim(s.device.id)).toBeNull();
        expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("cancelled");
        expect(network).not.toHaveBeenCalled();
    }
    finally {
        network.mockRestore();
    } });
    it("keeps ambiguous dispatches uncertain across restart and never reoffers them", async () => {
        const s = await setup(), c = (await claim(s.device.id))!;
        await permit(s.device.id, c);
        await prisma.autoCommentJob.update({ where: { id: c.id }, data: { claimUntil: new Date(0) } });
        await prepareBrowserComments(active);
        expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("uncertain");
        await updateCommentControl({ action: "stop" });
        await updateCommentControl({ action: "start" });
        await scanBrowserComments(active);
        expect(await prisma.autoCommentJob.count()).toBe(1);
        expect(await claim(s.device.id)).toBeNull();
    });
    it("records DOM observation separately and rejects foreign comment URLs", async () => {
        const s = await setup(), c = (await claim(s.device.id))!;
        await permit(s.device.id, c);
        expect(await reportBrowserComment(s.device.id, c.id, c.claimToken, "observed", "https://www.facebook.com/groups/12345/posts/8888/?comment_id=777")).toBe(true);
        expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("browser_observed");
        expect(await reportBrowserComment(s.device.id, c.id, c.claimToken, "uncertain")).toBe(true);
        expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("browser_observed");
        expect(await prisma.autoCommentLog.count({ where: { jobId: c.id, event: "browser_observed" } })).toBe(1);
    });
    it("keeps the system running after a single uncertain result and never retries that job", async () => {
        const s = await setup(), c = (await claim(s.device.id))!;
        await permit(s.device.id, c);
        await reportBrowserComment(s.device.id, c.id, c.claimToken, "observed", "https://other.example/?comment_id=1");
        expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("uncertain");
        expect(await readCommentControl()).toMatchObject({ state: "running" });
        expect((await prisma.autoCommentRule.findUniqueOrThrow({ where: { id: s.ruleId } })).pausedReason).toBe("");
        expect(await claim(s.device.id)).toBeNull();
    });
    it("keeps the rule and waiting queue running after repeated uncertain results", async () => {
        const s = await setup();
        await saveCommentRule({ ...s.input, areaCooldownSec: 30 }, s.ruleId);
        // This test exercises the three new posts below, not rearming the setup
        // post cancelled by the rule edit (covered separately).
        await prisma.post.update({ where: { id: s.post.id }, data: { dismissed: true } });
        await prisma.autoCommentJob.updateMany({ where: { status: "browser_ready" }, data: { nextAttemptAt: new Date(0), lastError: "" } });
        for (let i = 0; i < 3; i++) {
            await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: `https://www.facebook.com/groups/12345/posts/${9000 + i}/`, text: "หาช่างด่วน", normalizedText: "หาช่างด่วน", contentHash: `post-unc-${++serial}` } });
            await scanBrowserComments(active);
            await prepareBrowserComments(active);
            await prisma.autoCommentJob.updateMany({ where: { status: "browser_ready" }, data: { nextAttemptAt: new Date(0), lastError: "" } });
            await prisma.autoCommentLog.updateMany({ where: { event: "dispatch" }, data: { createdAt: new Date(Date.now() - 120000) } });
            const c = (await claim(s.device.id))!;
            expect(c).toMatchObject({ externalUrl: `https://www.facebook.com/groups/12345/posts/${9000 + i}/` });
            expect(await permit(s.device.id, c)).toMatchObject({ ttlMs: 3000 });
            if (i === 2) {
                const rule = await prisma.autoCommentRule.findUniqueOrThrow({ where: { id: s.ruleId } });
                const control = await readCommentControl();
                const waitingPost = await prisma.post.create({ data: {
                    sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/7771/",
                    text: "หาช่างแอร์ รอคิว", normalizedText: "หาช่างแอร์ รอคิว", contentHash: `post-wait-${++serial}`,
                } });
                await prisma.autoCommentJob.create({
                    data: {
                        ruleId: s.ruleId, postId: waitingPost.id, sourceId: s.source.id, pageId: "group:12345",
                        postKey: "group:12345:7771", dedupeKey: `hold-wait-${++serial}`,
                        externalUrl: "https://www.facebook.com/groups/12345/posts/7771/", message: "รอคิว", status: "browser_ready",
                        deliveryMode: "extension", browserDeviceId: s.device.id, browserFbUserId: s.input.browserFbUserId,
                        generation: control.generation, ruleRevision: rule.revision, textRevision: 0, dryRun: false, nextAttemptAt: new Date(0),
                    },
                });
            }
            await reportBrowserComment(s.device.id, c.id, c.claimToken, "uncertain");
        }
        expect(await readCommentControl()).toMatchObject({ state: "running" });
        expect((await prisma.autoCommentRule.findUniqueOrThrow({ where: { id: s.ruleId } })).pausedReason).toBe("");
        expect(await prisma.autoCommentJob.count({ where: { ruleId: s.ruleId, status: "uncertain" } })).toBe(3);
        const waiting = await prisma.autoCommentJob.findFirst({ where: { ruleId: s.ruleId, status: "browser_ready", message: "รอคิว" } });
        expect(waiting).toBeTruthy();
        expect(await prisma.autoCommentLog.count({ where: { ruleId: s.ruleId, event: "uncertain_noted" } })).toBeGreaterThanOrEqual(3);
        expect(await prisma.autoCommentLog.findFirst({ where: { ruleId: s.ruleId, event: "rule_paused" } })).toBeNull();
        // Uncertainty does not waive the last dispatch's real group cooldown.
        expect(await claim(s.device.id)).toBeNull();
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: waiting!.id } })).toMatchObject({ status: "browser_ready", lastError: "รอระยะพักของกลุ่ม" });
        // Advance fixture dispatch times beyond that cooldown, then make the
        // deferred row due; production limits and validity checks stay intact.
        await prisma.autoCommentLog.updateMany({ where: { event: "dispatch" }, data: { createdAt: new Date(Date.now() - 120000) } });
        await prisma.autoCommentJob.update({ where: { id: waiting!.id }, data: { nextAttemptAt: new Date(0) } });
        expect(await claim(s.device.id)).toMatchObject({ id: waiting!.id, message: "รอคิว", externalUrl: "https://www.facebook.com/groups/12345/posts/7771/" });
        expect(await prisma.autoCommentJob.count({ where: { ruleId: s.ruleId, status: "uncertain", attempts: 1 } })).toBe(3);
    });
    it("pauses global control on a Facebook checkpoint block", async () => {
        const s = await setup(), c = (await claim(s.device.id))!;
        await permit(s.device.id, c);
        const rule = await prisma.autoCommentRule.findUniqueOrThrow({ where: { id: s.ruleId } });
        const control = await readCommentControl();
        const waiting = await prisma.autoCommentJob.create({
            data: {
                ruleId: s.ruleId, postId: s.post.id, sourceId: s.source.id, pageId: "group:12345",
                postKey: "group:12345:7777", dedupeKey: `block-wait-${++serial}`,
                externalUrl: "https://www.facebook.com/groups/12345/posts/7777/", message: "รอ", status: "browser_ready",
                deliveryMode: "extension", browserDeviceId: s.device.id, browserFbUserId: s.input.browserFbUserId,
                generation: control.generation, ruleRevision: rule.revision, textRevision: 0, dryRun: false, nextAttemptAt: new Date(0),
            },
        });
        await reportBrowserComment(s.device.id, c.id, c.claimToken, "blocked");
        expect((await prisma.autoCommentJob.findFirstOrThrow({ where: { id: c.id } })).status).toBe("cancelled");
        expect(await readCommentControl()).toMatchObject({ state: "paused" });
        expect((await prisma.autoCommentRule.findUniqueOrThrow({ where: { id: s.ruleId } })).pausedReason).toBeTruthy();
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({
            status: "browser_ready",
            lastError: expect.stringMatching(/รอคิว/),
        });
    });
    it("retargets waiting jobs when only the pinned device changes", async () => {
        const s = await setup();
        expect(s.job).toMatchObject({ status: "browser_ready", browserDeviceId: s.device.id });
        const next = await prisma.extensionDevice.create({ data: { name: "Chrome Linux new", tokenHash: `hash-${++serial}`, tokenHint: "mbd_…new" } });
        await saveCommentRule({ ...s.input, browserDeviceId: next.id, areaCooldownSec: 60 }, s.ruleId);
        expect(await prisma.autoCommentJob.findFirstOrThrow()).toMatchObject({ status: "browser_ready", browserDeviceId: next.id, lastError: "" });
        expect(await prisma.autoCommentLog.findFirst({ where: { ruleId: s.ruleId, event: "rule_updated" }, orderBy: { createdAt: "desc" } })).toMatchObject({
            message: expect.stringContaining("คงคิวงานรอ"),
        });
    });
    it("enforces quota before a second dispatch", async () => {
        const s = await setup();
        await updateCommentControl({ hourlyLimit: 1 });
        const c = (await claim(s.device.id))!;
        await permit(s.device.id, c);
        await reportBrowserComment(s.device.id, c.id, c.claimToken, "observed", "https://www.facebook.com/groups/12345/posts/8888/?comment_id=777");
        await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/9999/", text: "หาช่างด่วน", normalizedText: "หาช่างด่วน", contentHash: `post-${++serial}` } });
        await scanBrowserComments(active);
        await prepareBrowserComments(active);
        const next = (await claim(s.device.id))!;
        expect(next).toBeNull();
        expect(await prisma.autoCommentJob.findFirst({ where: { postId: { not: s.post.id } } })).toMatchObject({ status: "browser_ready", lastError: "รอโควตารายชั่วโมง" });
        expect(await prisma.autoCommentLog.count({ where: { event: "dispatch" } })).toBe(1);
    });
    it("runtime tick does not call Facebook Graph even for old Page rules", async () => {
        const s = await setup();
        await prisma.autoCommentRule.update({ where: { id: s.ruleId }, data: { deliveryMode: "official", pageId: "12345" } });
        const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network"));
        try {
            await autoCommentTick(active);
            expect(network).not.toHaveBeenCalled();
        }
        finally {
            network.mockRestore();
        }
    });
    it("encrypts legacy settings on write and restores browser automation stopped", async () => {
        const s = await setup(), c = (await claim(s.device.id))!;
        await permit(s.device.id, c);
        await prisma.setting.create({ data: { key: "groq_api_key", value: encodeSetting("groq_api_key", "synthetic-test-key") } });
        expect((await prisma.setting.findUniqueOrThrow({ where: { key: "groq_api_key" } })).value).not.toContain("synthetic-test-key");
        const snapshot = JSON.parse(JSON.stringify(await snapshotDatabase(prisma)));
        await expect(restoreDatabase(prisma, snapshot)).rejects.toThrow(/Stop all/);
        await prisma.lease.deleteMany();
        await restoreDatabase(prisma, snapshot);
        expect(await readCommentControl()).toMatchObject({ state: "stopped", dryRun: false, emergency: true });
        expect((await prisma.autoCommentJob.findFirstOrThrow()).status).toBe("uncertain");
    });
});
describe.skipIf(!fixture.enabled)("live-only owner workflow", () => {
    it("changes legacy simulation to a fresh live run only after explicit Start, cancelling old pending jobs", async () => {
        const s = await setup({ dry: true });
        await prisma.autoCommentJob.update({ where: { id: s.job.id }, data: { status: "pending_ai" } });
        const before = await readCommentControl();
        const next = await updateCommentControl({ action: "start", dryRun: false, liveAcknowledged: true, liveOnly: true });
        expect(next).toMatchObject({ state: "running", dryRun: false });
        expect(next.generation).not.toBe(before.generation);
        const oldJob = await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: s.job.id } });
        expect(oldJob).toMatchObject({ status: "cancelled", dryRun: true });
        expect(await prisma.autoCommentLog.count({ where: { event: "dispatch" } })).toBe(0);
    });
    it("does not consume legacy simulated runs during normal worker ticks", async () => {
        const s = await setup({ dry: true });
        await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/112233/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: "legacy-simulation-inert" } });
        const before = await prisma.autoCommentJob.count();
        await autoCommentTick(active);
        expect(await prisma.autoCommentJob.count()).toBe(before);
        expect((await readCommentControl()).dryRun).toBe(true);
    });
    it("saving live quotas while stopped does not start work", async () => {
        const next = await updateCommentControl({ dryRun: false, liveAcknowledged: true, liveOnly: true, hourlyLimit: 6 });
        expect(next).toMatchObject({ state: "stopped", dryRun: false, hourlyLimit: 6 });
        expect(await prisma.autoCommentJob.count()).toBe(0);
    });
});
describe.skipIf(!fixture.enabled)("comment queue efficiency", () => {
    it("yields a scan between posts and resumes from durable evaluations without losing or duplicating work", async () => {
        const s = await setup();
        await prisma.post.createMany({ data: Array.from({ length: 8 }, (_, i) => ({ sourceId: s.source.id, externalUrl: `https://www.facebook.com/groups/12345/posts/${9100 + i}/`, text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `slice-${i}` })) });
        let clock = Date.now();
        const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
        try {
            await scanBrowserComments(async () => { clock += 1000; }, { deadlineMs: clock + 1500 });
        }
        finally {
            now.mockRestore();
        }
        expect(await prisma.autoCommentEvaluation.count()).toBe(2);
        await scanBrowserComments(active);
        expect(await prisma.autoCommentEvaluation.count()).toBe(9);
        expect(await prisma.autoCommentJob.count()).toBe(9);
        await scanBrowserComments(active);
        expect(await prisma.autoCommentJob.count()).toBe(9);
    });
    it("queues keyword matches as browser_ready immediately without an AI prepare hop", async () => {
        const s = await setup();
        await prisma.post.createMany({ data: Array.from({ length: 8 }, (_, i) => ({ sourceId: s.source.id, externalUrl: `https://www.facebook.com/groups/12345/posts/${9200 + i}/`, text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: `prepare-slice-${i}` })) });
        await scanBrowserComments(active);
        expect(await prisma.autoCommentJob.count({ where: { status: "pending_ai" } })).toBe(0);
        expect(await prisma.autoCommentJob.count({ where: { status: "browser_ready" } })).toBe(9);
        expect(await prisma.autoCommentLog.count({ where: { event: "dispatch" } })).toBe(0);
        expect(s.job.status).toBe("browser_ready");
    });
    it("slices legacy preparation recovery across worker deadlines", async () => {
        const s = await setup({ requireAi: true });
        // Setup post starts without a provider; mark every source post ready before the AI prepare hop.
        await prisma.post.update({ where: { id: s.post.id }, data: { aiProvider: "ollama" } });
        await prisma.post.createMany({ data: Array.from({ length: 8 }, (_, i) => ({
                sourceId: s.source.id,
                externalUrl: `https://www.facebook.com/groups/12345/posts/${9300 + i}/`,
                text: "หาช่างแอร์",
                normalizedText: "หาช่างแอร์",
                contentHash: `ai-prepare-slice-${i}`,
                aiProvider: "ollama",
            })) });
        await prisma.aiJob.createMany({ data: (await prisma.post.findMany({ where: { sourceId: s.source.id }, select: { id: true } })).map(post => ({ postId: post.id, status: "done" })) });
        // Setup deferred its original job for 30s while AI was unavailable. Make that
        // fixture due explicitly; completing classification does not bypass retryAt.
        await prisma.autoCommentJob.updateMany({ where: { status: "pending_ai" }, data: { nextAttemptAt: new Date() } });
        await scanBrowserComments(active);
        await prisma.autoCommentJob.updateMany({ data: { status: "pending_ai", nextAttemptAt: new Date() } });
        expect(await prisma.autoCommentJob.count({ where: { status: "pending_ai" } })).toBeGreaterThan(0);
        let clock = Date.now();
        const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
        try {
            await prepareBrowserComments(async () => { clock += 1000; }, { deadlineMs: clock + 1500 });
        }
        finally {
            now.mockRestore();
        }
        const pending = await prisma.autoCommentJob.count({ where: { status: "pending_ai" } });
        const ready = await prisma.autoCommentJob.count({ where: { status: "browser_ready" } });
        expect(pending + ready).toBe(9);
        expect(pending).toBeGreaterThan(0);
        await prepareBrowserComments(active);
        expect(await prisma.autoCommentJob.count({ where: { status: "browser_ready" } })).toBe(9);
    });
    it("checks group cooldown before claiming and defers only the remaining interval", async () => {
        const s = await setup();
        const now = Date.now();
        await prisma.autoCommentLog.create({ data: { event: "dispatch", pageId: s.job.pageId, jobId: s.job.id, ruleId: s.ruleId, createdAt: new Date(now - 30000) } });
        expect(await claim(s.device.id)).toBeNull();
        const row = await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: s.job.id } });
        expect(row.status).toBe("browser_ready");
        expect(row.claimToken).toBeNull();
        expect(row.nextAttemptAt.getTime()).toBeGreaterThan(now + 28000);
        expect(row.nextAttemptAt.getTime()).toBeLessThan(now + 35000);
    });
    it("does not evaluate unrelated or expired posts", async () => {
        const s = await setup({ dry: true });
        const other = await prisma.source.create({ data: { name: "unrelated", type: "facebook_group", url: "https://www.facebook.com/groups/998899" } });
        const unrelated = await prisma.post.create({ data: { sourceId: other.id, externalUrl: "https://www.facebook.com/groups/998899/posts/77/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: "unrelated-test" } });
        const expired = await prisma.post.create({ data: { sourceId: s.source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/78/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: "expired-test", postedAt: new Date(Date.now() - 25 * 3600000) } });
        await scanBrowserComments(active);
        expect(await prisma.autoCommentEvaluation.count({ where: { postId: { in: [unrelated.id, expired.id] } } })).toBe(0);
    });
});
describe.skipIf(!fixture.enabled)("efficient browser delivery failure handling", () => {
    it("retries only provably ungranted preparation, fences old tokens and stops after two retries", async () => {
        const s = await setup();
        let c = (await claim(s.device.id))!;
        for (let retry = 0; retry < 2; retry++) {
            expect(await reportBrowserComment(s.device.id, c.id, c.claimToken, "failed")).toBe(true);
            const row = await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: c.id } });
            expect(row).toMatchObject({ status: "browser_ready", attempts: 0, dispatchedAt: null, claimToken: null });
            expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 25000);
            expect(await reportBrowserComment(s.device.id, c.id, c.claimToken, "failed")).toBe(true);
            expect(await prisma.autoCommentLog.count({ where: { jobId: c.id, event: "prepare_retry" } })).toBe(retry + 1);
            await prisma.autoCommentJob.update({ where: { id: c.id }, data: { nextAttemptAt: new Date(0) } });
            const previous = c;
            c = (await claim(s.device.id))!;
            expect(c.claimToken).not.toBe(previous.claimToken);
            expect(await permit(s.device.id, previous)).toBeNull();
            expect(await reportBrowserComment(s.device.id, previous.id, previous.claimToken, "failed")).toBe(false);
        }
        await reportBrowserComment(s.device.id, c.id, c.claimToken, "failed");
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "cancelled", attempts: 0, dispatchedAt: null });
        expect((await readCommentControl()).state).toBe("running");
        expect(await prisma.autoCommentLog.count({ where: { event: "dispatch" } })).toBe(0);
    });
    it("recovers an expired ungranted claim but does not requeue it after Stop", async () => {
        const s = await setup(), c = (await claim(s.device.id))!;
        await prisma.autoCommentJob.update({ where: { id: c.id }, data: { claimUntil: new Date(0) } });
        await prepareBrowserComments(active);
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "browser_ready", attempts: 0, dispatchedAt: null });
        await updateCommentControl({ action: "stop" });
        await prepareBrowserComments(active);
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "cancelled" });
    });
    it("records definite non-delivery without pausing or rearming a dispatched key", async () => {
        const s = await setup(), c = (await claim(s.device.id))!;
        await permit(s.device.id, c);
        expect(await reportBrowserComment(s.device.id, c.id, c.claimToken, "not_sent")).toBe(true);
        const job = await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: c.id } });
        expect(job).toMatchObject({ status: "not_sent", attempts: 1 });
        expect(job.dispatchedAt).not.toBeNull();
        expect((await readCommentControl()).state).toBe("running");
        expect((await prisma.autoCommentRule.findUniqueOrThrow({ where: { id: s.ruleId } })).pausedReason).toBe("");
        await prisma.post.update({ where: { id: s.post.id }, data: { textRevision: { increment: 1 } } });
        await scanBrowserComments(active);
        await prepareBrowserComments(active);
        expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("not_sent");
        expect(await reportBrowserComment(s.device.id, c.id, c.claimToken, "not_sent")).toBe(true);
        expect(await prisma.autoCommentLog.count({ where: { event: "not_sent", jobId: c.id } })).toBe(1);
        expect(await reportBrowserComment("other-device", c.id, c.claimToken, "not_sent")).toBe(false);
    });
    it("continues past a group on cooldown to another eligible group", async () => {
        const s = await setup();
        const other = await prisma.source.create({ data: { name: "eligible group", type: "facebook_group", url: "https://www.facebook.com/groups/67890" } });
        await saveCommentRule({ ...s.input, sourceIds: [s.source.id, other.id] }, s.ruleId);
        const post = await prisma.post.create({ data: { sourceId: other.id, externalUrl: "https://www.facebook.com/groups/67890/posts/1111/", text: "หาช่างแอร์", normalizedText: "หาช่างแอร์", contentHash: "eligible-group" } });
        await scanBrowserComments(active);
        await prepareBrowserComments(active);
        await prisma.autoCommentLog.create({ data: { event: "dispatch", pageId: s.job.pageId, jobId: s.job.id, ruleId: s.ruleId, createdAt: new Date(Date.now() - 30000) } });
        const claimed = await claim(s.device.id);
        expect(claimed?.externalUrl).toContain("/67890/");
        expect(await prisma.autoCommentJob.findFirst({ where: { postId: post.id } })).toMatchObject({ status: "claimed" });
    });
    it("rechecks quota after claim and acknowledges a known deferral without cancelling it", async () => {
        const s = await setup();
        await updateCommentControl({ hourlyLimit: 1 });
        const c = (await claim(s.device.id))!;
        await prisma.autoCommentLog.create({ data: { event: "dispatch", pageId: "other-group", createdAt: new Date() } });
        expect(await permit(s.device.id, c)).toBeNull();
        expect(await reportBrowserComment(s.device.id, c.id, c.claimToken, "not_sent")).toBe(true);
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "browser_ready", attempts: 0, claimToken: null });
        expect((await readCommentControl()).state).toBe("running");
    });
    it("skips scan SQL when no enabled bound rule can receive work", async () => {
        const s = await setup();
        await prisma.autoCommentRule.update({ where: { id: s.ruleId }, data: { enabled: false } });
        const original = prisma.$queryRaw;
        const query = vi.spyOn(prisma, "$queryRaw");
        try {
            await scanBrowserComments(active);
            expect(query).not.toHaveBeenCalled();
        }
        finally {
            query.mockRestore();
            // Prisma's extended client is a proxy; restoring its descriptor alone can hide the method.
            prisma.$queryRaw = original;
        }
    });
});
describe.skipIf(!fixture.enabled)("quota changes wake deferred work", () => {
    it("rechecks a job immediately after the owner raises its quota", async () => {
        const s = await setup();
        await updateCommentControl({ hourlyLimit: 1 });
        await prisma.autoCommentLog.create({ data: { event: "dispatch", pageId: "other", createdAt: new Date() } });
        expect(await claim(s.device.id)).toBeNull();
        expect((await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: s.job.id } })).nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 3000000);
        const before = await readCommentControl();
        await updateCommentControl({ hourlyLimit: 2 });
        const after = await readCommentControl();
        expect(after.state).toBe(before.state);
        expect(after.generation).toBe(before.generation);
        expect(await claim(s.device.id)).not.toBeNull();
    });
});
describe.skipIf(!fixture.enabled)("read-only automation observation", () => {
    it("streams a burst of 25 stored posts sharing one timestamp without losing the tail", async () => {
        const s = await setup({ dry: true });
        const at = new Date(Date.now() + 1000);
        await prisma.post.createMany({ data: Array.from({ length: 25 }, (_, index) => ({ id: `stream-${String(index).padStart(2, "0")}`,
                sourceId: s.source.id, externalUrl: `https://www.facebook.com/groups/12345/posts/${9500 + index}/`,
                text: "synthetic", normalizedText: "synthetic", contentHash: `stream-${++serial}`, createdAt: at })) });
        let cursor: PostStreamCursor = { createdAt: at, id: null };
        const ids: string[] = [];
        for (let batch = 0; batch < 3; batch++) {
            const rows = await prisma.post.findMany({ where: postStreamWhere(cursor), orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20, select: { id: true, createdAt: true } });
            ids.push(...rows.map(row => row.id));
            if (!rows.length)
                break;
            const last = rows[rows.length - 1];
            cursor = { createdAt: last.createdAt, id: last.id };
        }
        expect(ids).toHaveLength(25);
        expect(new Set(ids).size).toBe(25);
    });
    it("stores aggregate tab status for overview without changing comment control or jobs", async () => {
        const s = await setup();
        const tabs = { activeReaders: 1, activeComments: 0, parkedReaders: 2, closing: 1, idleReaders: 0, released: 3, retryAt: Date.now() + 30000 };
        const before = await readCommentControl();
        await recordHeartbeat(heartbeatSchema.parse({ installId: "synthetic-lifecycle", version: EXPECTED_EXTENSION_VERSION,
            runtime: { tabs } }), s.device.id);
        const stored = await prisma.setting.findUniqueOrThrow({ where: { key: "extension_tab_status" } });
        expect(JSON.parse(stored.value)).toMatchObject({ ...tabs, version: EXPECTED_EXTENSION_VERSION });
        expect(stored.value).not.toContain(s.post.text);
        expect(stored.value).not.toContain(s.device.id);
        expect(await readCommentControl()).toEqual(before);
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: s.job.id } })).toMatchObject({ status: "browser_ready", attempts: 0 });
        expect((await collectObservation(prisma, new Date(Date.now() - 60000))).extension.tabs).toMatchObject({ closing: 1, parkedReaders: 2 });
        await prisma.setting.update({ where: { key: "extension_tab_status" }, data: { value: JSON.stringify({ ...tabs, version: "old", at: new Date().toISOString() }) } });
        expect((await collectObservation(prisma, new Date(Date.now() - 60000))).extension.tabs).toBeNull();
    });
    it("collects aggregate evidence without changing jobs, consent or control", async () => {
        const s = await setup();
        const since = new Date(Date.now() - 3600000);
        const fixtures = [
            { stoppedBy: "cap", ok: true, found: 10 },
            { stoppedBy: "loading", ok: true, found: 1 },
            { stoppedBy: "exhausted", ok: true, found: 0, hitLimit: true },
            { stoppedBy: "end", ok: true, found: 1 },
            { stoppedBy: "error", ok: false, found: 0 },
        ];
        await prisma.scrapeRun.createMany({ data: fixtures.map(run => ({ ...run, sourceId: s.source.id, extVersion: EXPECTED_EXTENSION_VERSION, inserted: 2 })) });
        await prisma.scrapeRun.create({ data: { sourceId: s.source.id, extVersion: "old-version", inserted: 999 } });
        // Keep the whole synthetic timeline in the past. A fast local database
        // must not count a future receipt or depend on 1.5s of network latency.
        const ingestedAt = Date.now() - 10000;
        await prisma.post.update({ where: { id: s.post.id }, data: { createdAt: new Date(ingestedAt) } });
        await prisma.autoCommentLog.updateMany({ where: { jobId: s.job.id, event: "browser_ready" }, data: { createdAt: new Date(ingestedAt + 500) } });
        await prisma.autoCommentLog.create({ data: { event: "browser_observed", jobId: s.job.id, createdAt: new Date(ingestedAt + 1500) } });
        await prisma.extensionHeartbeat.create({ data: { id: "observation-device", version: EXPECTED_EXTENSION_VERSION, outboxSize: 2 } });
        await prisma.setting.create({ data: { key: "extension_capture", value: JSON.stringify({ at: new Date().toISOString(), pendingPosts: 5, parkedFeeds: 1, oldestPendingAt: Date.now() - 60000, token: "synthetic-private-value" }) } });
        const before = await readCommentControl();
        await prisma.post.update({ where: { id: s.post.id }, data: {
            processingState: "pending_edit", processingQueuedAt: new Date(Date.now() - 900000),
            processingToken: "synthetic-claim", processingRetryAt: new Date(Date.now() + 60000),
        } });
        const sample = await collectObservation(prisma, since);
        expect(sample.processing.pending).toBeGreaterThanOrEqual(1);
        expect(sample.processing.running).toBeGreaterThanOrEqual(1);
        expect(sample.processing.oldestPendingSeconds).toBeGreaterThanOrEqual(900);
        expect(sample.collection).toMatchObject({ runs: 5, newPosts: 10, loadingOrStalled: 1,
            incomplete: fixtures.filter(run => isIncompleteScrape({ ...run, postsFound: run.found })).length });
        expect(sample.comments).toEqual({ browser_ready: 1 });
        expect(sample.latency).toMatchObject({ observedCount: 1, ingestToObservedP50Seconds: 1.5, ingestToObservedP95Seconds: 1.5 });
        expect(sample.extension).toMatchObject({ onlineDevices: 1, outboxBatches: 2, capture: { pendingPosts: 5, parkedFeeds: 1 } });
        expect(sample.extension.capture.oldestPendingSeconds).toBeGreaterThanOrEqual(60);
        expect(sample.stages).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "browser_ready", count: 1 }), expect.objectContaining({ stage: "browser_observed", p50Seconds: 1.5 })]));
        expect(await readCommentControl()).toEqual(before);
        expect(await prisma.autoCommentJob.findUniqueOrThrow({ where: { id: s.job.id } })).toMatchObject({ status: "browser_ready", attempts: 0, dispatchedAt: null });
        expect(JSON.stringify(sample)).not.toContain(s.post.text);
        expect(JSON.stringify(sample)).not.toContain(s.device.id);
        expect(JSON.stringify(sample)).not.toContain("synthetic-private-value");
        await prisma.extensionHeartbeat.update({ where: { id: "observation-device" }, data: { lastSeenAt: new Date(Date.now() - 900000) } });
        const stale = await collectObservation(prisma, since);
        expect(stale.extension).toMatchObject({ onlineDevices: 0, outboxBatches: null, capture: null });
    });
});
it("validates observation duration and cadence without requiring database credentials", () => {
    expect(observationOptions([])).toMatchObject({ hours: 24, intervalSeconds: 60 });
    expect(observationOptions(["--once"])).toMatchObject({ once: true });
    for (const args of [["--hours=NaN"], ["--hours=-1"], ["--interval-seconds=0"], ["--unknown"], ["--hours=1", "--hours=2"]]) {
        expect(() => observationOptions(args)).toThrow();
    }
});
