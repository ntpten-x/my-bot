import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
const fixture = vi.hoisted(() => {
    const { createRequire } = process.getBuiltinModule("node:module");
    const path = process.getBuiltinModule("node:path");
    const db = createRequire(path.resolve("package.json"))("./tests/helpers/pg-test-db.cjs");
    const { enabled, schema } = db.setupTestDatabase("test_integration") as {
        enabled: boolean;
        schema: string;
    };
    process.env.MYBOT_PROCESS = "worker";
    return { enabled, schema, dropTestSchema: db.dropTestSchema as (prisma: unknown, schema: string) => Promise<void> };
});
vi.mock("../../src/lib/log", () => ({ workerLog: vi.fn(async () => undefined) }));
vi.mock("../../src/lib/guard", () => ({ authed: vi.fn(async () => ({ error: null })) }));
import { prisma } from "../../src/lib/prisma";
import { ingestPosts } from "../../src/lib/ingest";
import { enqueueAiJobs, enqueueUnclassifiedPosts, MAX_AI_ATTEMPTS, processAiQueue } from "../../src/lib/ai/queue";
import { clearProviderHealthCache } from "../../src/lib/ai/health";
import { resetTokenBuckets } from "../../src/lib/ai/bucket";
import { enrichPosts, collapseTruncatedCaptures, collapseIdenticalTexts } from "../../src/lib/smart/enrich";
import { recordFeedback } from "../../src/lib/smart/feedback";
import { backfillEmbeddings } from "../../src/lib/smart/backfill";
import { getSettings } from "../../src/lib/settings";
import { GET as search } from "../../src/app/api/posts/route";
import { processNotificationQueue } from "../../src/lib/notification-queue";
import { embeddingConfig, embeddingTextKey } from "../../src/lib/smart/embedding-key";
import { clearEmbeddingHealthCache } from "../../src/lib/smart/embed";
let partial = false;
let providerDown = false;
let embedDown = false;
let lineDown = false;
let rateLimited = false;
const network = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/api/tags"))
        return Response.json({ models: [{ name: "qwen2.5:7b" }, { name: "bge-m3:latest" }] });
    if (url.endsWith("/api/chat")) {
        if (rateLimited)
            return Response.json({}, { status: 429, headers: { "retry-after": "120" } });
        if (providerDown)
            return Response.json({}, { status: 503 });
        const body = JSON.parse(String(init?.body));
        const posts = JSON.parse(body.messages[1].content.split("โพสต์:\n")[1]) as {
            id: string;
        }[];
        return Response.json({ message: { content: JSON.stringify({ items: (partial ? posts.slice(0, 1) : posts).map(post => ({ id: post.id, intent: "buyer", categorySlug: "it", isAd: false })) }) } });
    }
    if (url.endsWith("/api/embed") || url.endsWith("/api/embeddings")) {
        if (embedDown)
            return Response.json({}, { status: 503 });
        return Response.json({ embeddings: [[0.3, 0.7, 0.2]] });
    }
    if (url === "https://discord.com/api/webhooks/123456789/synthetic-fixture-token")
        return Response.json({});
    if (url === "https://api.line.me/v2/bot/message/push")
        return Response.json({}, { status: lineDown ? 503 : 200 });
    throw new Error(`Unexpected network request in isolated test: ${new URL(url).pathname}`);
});
beforeAll(() => {
    if (!fixture.enabled)
        return;
    execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env }, stdio: "pipe" });
}, 180000);
beforeEach(async () => {
    if (!fixture.enabled)
        return;
    await prisma.post.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.keyword.deleteMany();
    await prisma.preferenceWeight.deleteMany();
    await prisma.aiCache.deleteMany();
    await prisma.source.deleteMany();
    await prisma.setting.deleteMany();
    await prisma.category.deleteMany();
    await prisma.category.create({ data: { name: "ไอที", slug: "it" } });
    await prisma.keyword.create({ data: { word: "iPad", type: "watch" } });
    await prisma.setting.createMany({ data: [{ key: "ai_provider", value: "ollama" }, { key: "ocr_enabled", value: "false" }, { key: "gemini_api_key", value: "" }, { key: "embed_model", value: "bge-m3" }, { key: "ollama_base_url", value: "http://127.0.0.1:11434" }] });
    await prisma.source.create({ data: { id: "source", type: "facebook_group", name: "ทดสอบ", url: "https://www.facebook.com/groups/123" } });
    partial = false;
    providerDown = false;
    embedDown = false;
    lineDown = false;
    rateLimited = false;
    network.mockClear();
    resetTokenBuckets();
    clearProviderHealthCache();
    clearEmbeddingHealthCache();
    vi.stubGlobal("fetch", network);
    process.env.MYBOT_PROCESS = "worker";
    // No actual credentials/providers are used by the network stub.
    process.env.GEMINI_API_KEY = "";
    process.env.DISCORD_WEBHOOK_URL = "";
    process.env.SMTP_HOST = "";
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "";
});
afterAll(async () => {
    vi.unstubAllGlobals();
    if (fixture.enabled)
        await fixture.dropTestSchema(prisma, fixture.schema);
    await prisma.$disconnect();
});
async function ingest(count = 2) {
    return ingestPosts({ sourceUrl: "https://www.facebook.com/groups/123", actor: "extension", posts: Array.from({ length: count }, (_, i) => ({ url: `https://www.facebook.com/groups/123/posts/${i + 1}`, text: `ตามหา iPad รุ่นทดสอบ ${i} มือสอง งบ 5000 บาท` })) });
}
describe.skipIf(!fixture.enabled)("real Postgres ingest → queue → provider → completion", () => {
    it("keeps the full capture when partial and full versions share a transport batch", async () => {
        const url = "https://www.facebook.com/groups/123/posts/90006";
        const full = "ตามหา iPad มือสอง งบ 5000 บาท ไม่รับเครื่องติดล็อก ขอรายละเอียดครบครับ";
        await ingestPosts({ sourceUrl: "https://www.facebook.com/groups/123", actor: "extension", posts: [
            { url, text: "ตามหา iPad มือสอง ดูเพิ่มเติม" }, { url, text: full },
        ] }, { deferFinalize: true });
        expect(await prisma.post.findFirstOrThrow()).toMatchObject({ text: full, truncated: false });
        expect(await prisma.post.count()).toBe(1);
    });
    it("recovers acknowledged posts even when the after-response callback never runs", async () => {
        const result = await ingestPosts({ sourceUrl: "https://www.facebook.com/groups/123", actor: "extension", posts: [
            { url: "https://www.facebook.com/groups/123/posts/90001", text: "ตามหา iPad มือสอง งบ 5000 บาท" },
        ] }, { deferFinalize: true });
        expect(result.ok).toBe(true);
        const post = await prisma.post.findFirstOrThrow();
        expect((post as unknown as Record<string, unknown>).processingState).toBe("pending_new");
        // Do not call result._finalize: emulate a process dying after the durable receipt.
        const pipeline = await import("../../src/lib/ingest");
        expect(typeof (pipeline as unknown as Record<string, unknown>).processPendingIngest).toBe("function");
        expect(await pipeline.processPendingIngest()).toBe(1);
        const completed = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
        expect(completed.processingState).toBe("done");
        expect(completed.score).toBeGreaterThan(0);
        expect(completed.processingToken).toBeNull();
        expect(await pipeline.processPendingIngest()).toBe(0);
        expect(network).not.toHaveBeenCalled();
    });
    it("fences a stale callback while retaining new-post work through a text expansion", async () => {
        const input = { sourceUrl: "https://www.facebook.com/groups/123", actor: "extension" as const, posts: [{ url: "https://www.facebook.com/groups/123/posts/90002", text: "ตามหา iPad มือสอง ดูเพิ่มเติม" }] };
        const old = await ingestPosts(input, { deferFinalize: true });
        await ingestPosts({ ...input, posts: [{ ...input.posts[0], text: "ตามหา iPad มือสอง งบ 5000 บาท พร้อมรายละเอียดครบแล้วครับ" }] }, { deferFinalize: true });
        if (!old.ok || !("_finalize" in old)) throw new Error("Missing callback");
        await old._finalize();
        expect(await prisma.post.findFirstOrThrow()).toMatchObject({ processingState: "pending_new", processingToken: null, textRevision: 1 });
        const { processPendingIngest } = await import("../../src/lib/ingest");
        expect(await processPendingIngest()).toBe(1);
        const current = await prisma.post.findFirstOrThrow();
        expect(current.processingState).toBe("done");
        expect(current.score).toBeGreaterThan(0);
    });
    it("yields a processing slice without acknowledging or losing unfinished work", async () => {
        await ingestPosts({ sourceUrl: "https://www.facebook.com/groups/123", actor: "extension", posts: [
            { url: "https://www.facebook.com/groups/123/posts/90007", text: "ตามหา iPad รุ่นแรก งบ 5000" },
            { url: "https://www.facebook.com/groups/123/posts/90008", text: "ตามหา iPad รุ่นสอง งบ 9000" },
        ] }, { deferFinalize: true });
        const rows = await prisma.post.findMany({ select: { id: true, textRevision: true } });
        const { runPostProcessing } = await import("../../src/lib/post-processing");
        expect(await runPostProcessing(rows, async claimed => [claimed[0].id])).toBe(1);
        expect(await prisma.post.count({ where: { processingState: "done" } })).toBe(1);
        expect(await prisma.post.count({ where: { processingState: "pending_new", processingToken: null, processingRetryAt: { lte: new Date() } } })).toBe(1);
        const { processPendingIngest } = await import("../../src/lib/ingest");
        expect(await processPendingIngest()).toBe(1);
    });
    it("reclaims expired post work and never emits the same in-app notice twice", async () => {
        await prisma.setting.create({ data: { key: "notify_min_score", value: "0" } });
        await ingestPosts({ sourceUrl: "https://www.facebook.com/groups/123", actor: "extension", posts: [{ url: "https://www.facebook.com/groups/123/posts/90003", text: "ตามหา iPad มือสอง ด่วน งบ 5000 บาท" }] }, { deferFinalize: true });
        const post = await prisma.post.findFirstOrThrow();
        await prisma.post.update({ where: { id: post.id }, data: { processingToken: "crashed-process", processingRetryAt: new Date(0) } });
        const { processPendingIngest } = await import("../../src/lib/ingest");
        expect(await processPendingIngest()).toBe(1);
        const notices = await prisma.notification.count({ where: { postId: post.id, channel: "in_app" } });
        expect(notices).toBe(1);
        await prisma.post.update({ where: { id: post.id }, data: { processingState: "pending_new", processingRetryAt: new Date(0) } });
        expect(await processPendingIngest()).toBe(1);
        expect(await prisma.notification.count({ where: { postId: post.id, channel: "in_app" } })).toBe(notices);
        expect(await prisma.notification.count({ where: { postId: post.id, channel: "external_pending" } })).toBeLessThanOrEqual(1);
    });
    it("rolls rule hits back with failed actions and retries the durable work once due", async () => {
        const rule = await prisma.automationRule.create({ data: { name: "durable-rule-test", keywords: "iPad", actionSave: true, actionNotify: true } });
        await ingestPosts({ sourceUrl: "https://www.facebook.com/groups/123", actor: "extension", posts: [
            { url: "https://www.facebook.com/groups/123/posts/90004", text: "ตามหา iPad มือสอง งบ 5000 บาท" },
            { url: "https://www.facebook.com/groups/123/posts/90005", text: "ตามหา iPad รุ่นใหม่ งบ 9000 บาท" },
        ] }, { deferFinalize: true });
        await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fixture.schema}".reject_rule_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rule action failure'; END $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_rule_effect BEFORE UPDATE OF "pipelineStatus" ON "Post" FOR EACH ROW EXECUTE FUNCTION "${fixture.schema}".reject_rule_effect()`);
        const { processPendingIngest } = await import("../../src/lib/ingest");
        try {
            await expect(processPendingIngest()).rejects.toThrow();
            expect(await prisma.ruleHit.count({ where: { ruleId: rule.id } })).toBe(0);
            expect(await prisma.post.count({ where: { processingState: "pending_new", processingToken: null, processingError: { not: "" } } })).toBe(2);
            expect(await processPendingIngest()).toBe(0);
        } finally {
            await prisma.$executeRawUnsafe('DROP TRIGGER reject_rule_effect ON "Post"');
            await prisma.$executeRawUnsafe(`DROP FUNCTION "${fixture.schema}".reject_rule_effect()`);
        }
        await prisma.post.updateMany({ data: { processingRetryAt: new Date(0) } });
        expect(await processPendingIngest()).toBe(2);
        expect(await prisma.ruleHit.count({ where: { ruleId: rule.id } })).toBe(2);
        expect(await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({ hitCount: 2 });
        expect(await prisma.post.count({ where: { processingState: "done", pipelineStatus: "following" } })).toBe(2);
        await prisma.automationRule.delete({ where: { id: rule.id } });
    });
    it("atomically stores transport batches with rule labels and no model jobs", async () => { await ingest(83); expect(await prisma.post.count()).toBe(83); expect(await prisma.post.count({ where: { aiProvider: "rules" } })).toBe(83); expect(await prisma.aiJob.count()).toBe(0); expect(network).not.toHaveBeenCalled(); });
    it("ingestion is independent of the removed model queue", async () => { await prisma.$executeRawUnsafe(`CREATE FUNCTION "${fixture.schema}".reject_ai_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic enqueue failure'; END $$`); await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_ai_enqueue BEFORE INSERT ON "AiJob" FOR EACH ROW EXECUTE FUNCTION "${fixture.schema}".reject_ai_enqueue()`); try {
        await ingest(3);
        expect(await prisma.post.count()).toBe(3);
        expect(await prisma.aiJob.count()).toBe(0);
    }
    finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER reject_ai_enqueue ON "AiJob"');
        await prisma.$executeRawUnsafe(`DROP FUNCTION "${fixture.schema}".reject_ai_enqueue()`);
    } });
    it("deduplicates competing capture batches without a model queue", async () => { const out = await Promise.all([ingest(4), ingest(4)]); expect(out.reduce((sum, row) => sum + row.inserted, 0)).toBe(4); expect(await prisma.post.count()).toBe(4); expect(await prisma.aiJob.count()).toBe(0); });
    it("returns scored and classified posts without any network call", async () => { await ingest(2); const posts = await prisma.post.findMany(); expect(posts).toHaveLength(2); expect(posts.every(p => p.aiProvider === "rules" && p.intent === "buyer" && p.score > 0)).toBe(true); expect(network).not.toHaveBeenCalled(); });
    it("cannot re-enable models using a legacy setting or backfill command", async () => { await ingest(1); await prisma.setting.update({ where: { key: "ai_provider" }, data: { value: "auto" } }); expect((await getSettings()).aiProvider).toBe("rules"); expect(await enqueueUnclassifiedPosts(true)).toBe(0); expect(await processAiQueue()).toBe(0); expect(await prisma.aiJob.count()).toBe(0); expect(network).not.toHaveBeenCalled(); });
    it("does not create embeddings or alter historical vectors", async () => { await ingest(1); const post = await prisma.post.findFirstOrThrow(); await prisma.post.update({ where: { id: post.id }, data: { embeddingJson: "[1,0]", embeddingConfig: "historical", embeddingKey: "historical|old" } }); expect(await backfillEmbeddings()).toMatchObject({ tried: 0, filled: 0 }); await enrichPosts([post.id], [], await getSettings()); expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).embeddingJson).toBe("[1,0]"); expect(network).not.toHaveBeenCalled(); });
    it("finds truncated duplicates beyond the former 500-post cutoff", async () => {
        await prisma.post.createMany({ data: Array.from({ length: 501 }, (_, i) => ({ id: `old-${String(i).padStart(4, "0")}`, sourceId: "source", externalUrl: `https://example.test/${i}`, text: `other ${i}`, normalizedText: `other ${i}`, contentHash: `old-${i}` })) });
        const prefix = "ตามหาผู้รับทำเว็บไซต์สำหรับร้านค้าในกรุงเทพมหานคร งบประมาณหนึ่งหมื่นบาท กรุณาติดต่อ ";
        await prisma.post.createMany({ data: [
                { id: "z-short", sourceId: "source", externalUrl: "https://example.test/short", text: `${prefix} ดูเพิ่มเติม`, normalizedText: prefix, contentHash: "short" },
                { id: "z-long", sourceId: "source", externalUrl: "https://example.test/long", text: `${prefix} พร้อมรายละเอียดเพิ่มเติมและนัดหมาย`, normalizedText: `${prefix} more`, contentHash: "long" },
            ] });
        expect(await collapseTruncatedCaptures("source")).toBe(1);
        expect((await prisma.post.findUniqueOrThrow({ where: { id: "z-short" } })).duplicateOfId).toBe("z-long");
    });
    it("paginates all keyword matches, including older posts past 200", async () => {
        await prisma.post.createMany({ data: Array.from({ length: 235 }, (_, i) => ({ sourceId: "source", externalUrl: `https://example.test/${i}`, text: `ตามหา ipad ${i}`, normalizedText: `ตามหา ipad ${i}`, contentHash: `search-${i}` })) });
        const response = await search(new Request("http://localhost/api/posts?q=ipad&page=8"));
        const data = await response.json();
        expect(data.total).toBe(235);
        expect(data.posts).toHaveLength(25);
        expect(data.posts[0]).not.toHaveProperty("embeddingJson");
    });
    it("queues outbound notifications during ingest and retries only channels not already delivered", async () => {
        await prisma.setting.createMany({ data: [{ key: "discord_webhook", value: "https://discord.com/api/webhooks/123456789/synthetic-fixture-token" }, { key: "line_token", value: "fixture-token" }, { key: "line_user_id", value: "fixture-user" }] });
        await ingest(1);
        expect(network).not.toHaveBeenCalled();
        expect(await prisma.notification.count({ where: { channel: "in_app" } })).toBe(1);
        lineDown = true;
        await processNotificationQueue();
        expect(await prisma.notification.count({ where: { channel: "discord" } })).toBe(1);
        expect(await prisma.notification.count({ where: { channel: "line" } })).toBe(0);
        lineDown = false;
        await prisma.notification.updateMany({ where: { channel: "external_pending" }, data: { createdAt: new Date() } });
        await processNotificationQueue();
        expect(network.mock.calls.filter(([url]) => String(url) === "https://discord.com/api/webhooks/123456789/synthetic-fixture-token")).toHaveLength(1);
        expect(await prisma.notification.count({ where: { channel: "line" } })).toBe(1);
    });
    it("ignores legacy semantic requests and paginates every keyword result", async () => { await prisma.post.createMany({ data: Array.from({ length: 1010 }, (_, i) => ({ sourceId: "source", externalUrl: `https://example.test/${i}`, text: `ตามหา ipad ${i}`, normalizedText: `ตามหา ipad ${i}`, contentHash: `search-many-${i}`, embeddingJson: "[1,0]" })) }); const data = await (await search(new Request("http://localhost/api/posts?q=ipad&semantic=1"))).json(); expect(data.semantic).toBe(false); expect(data.total).toBe(1010); expect(data.posts).toHaveLength(30); expect(network).not.toHaveBeenCalled(); });
    it("updates explicit feedback weights without embeddings or model calls", async () => { await ingest(1); const post = await prisma.post.findFirstOrThrow(); await recordFeedback(post.id, "save"); await recordFeedback(post.id, "contacted"); expect(await prisma.preferenceWeight.findUnique({ where: { kind_key: { kind: "source", key: "source" } } })).toMatchObject({ weight: 3 }); expect(await prisma.setting.count({ where: { key: { startsWith: "pref_liked_" } } })).toBe(0); expect(network).not.toHaveBeenCalled(); });
    it("repairs all exact-duplicate groups rather than stopping after the first 50", async () => {
        await prisma.post.createMany({ data: Array.from({ length: 102 }, (_, i) => ({ sourceId: "source", externalUrl: `https://example.test/${i}`, text: `same capture group number ${Math.floor(i / 2)}`, normalizedText: `same capture group number ${Math.floor(i / 2)}`, contentHash: `exact-${i}` })) });
        expect(await collapseIdenticalTexts()).toBe(51);
        expect(await prisma.post.count({ where: { duplicateOfId: { not: null } } })).toBe(51);
    });
});
