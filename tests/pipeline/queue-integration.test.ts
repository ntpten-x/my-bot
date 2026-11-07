import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const fixture = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module");
  const path = process.getBuiltinModule("node:path");
  const db = createRequire(path.resolve("package.json"))("./tests/helpers/pg-test-db.cjs");
  const { enabled, schema } = db.setupTestDatabase("test_integration") as { enabled: boolean; schema: string };
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
  if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen2.5:7b" }, { name: "bge-m3:latest" }] });
  if (url.endsWith("/api/chat")) {
    if (rateLimited) return Response.json({}, { status: 429, headers: { "retry-after": "120" } });
    if (providerDown) return Response.json({}, { status: 503 });
    const body = JSON.parse(String(init?.body));
    const posts = JSON.parse(body.messages[1].content.split("โพสต์:\n")[1]) as { id: string }[];
    return Response.json({ message: { content: JSON.stringify({ items: (partial ? posts.slice(0, 1) : posts).map(post => ({ id: post.id, intent: "buyer", categorySlug: "it", isAd: false })) }) } });
  }
  if (url.endsWith("/api/embed") || url.endsWith("/api/embeddings")) {
    if (embedDown) return Response.json({}, { status: 503 });
    return Response.json({ embeddings: [[0.3, 0.7, 0.2]] });
  }
  if (url === "https://example.test/webhook") return Response.json({});
  if (url === "https://api.line.me/v2/bot/message/push") return Response.json({}, { status: lineDown ? 503 : 200 });
  throw new Error(`Unexpected network request in isolated test: ${new URL(url).pathname}`);
});

beforeAll(() => {
  if (!fixture.enabled) return;
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env }, stdio: "pipe" });
}, 180_000);
beforeEach(async () => {
  if (!fixture.enabled) return;
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
  partial = false; providerDown = false; embedDown = false; lineDown = false; rateLimited = false;
  network.mockClear(); resetTokenBuckets(); clearProviderHealthCache(); clearEmbeddingHealthCache();
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
  if (fixture.enabled) await fixture.dropTestSchema(prisma, fixture.schema);
  await prisma.$disconnect();
});

async function ingest(count = 2) {
  return ingestPosts({ sourceUrl: "https://www.facebook.com/groups/123", actor: "extension", posts: Array.from({ length: count }, (_, i) => ({ url: `https://www.facebook.com/groups/123/posts/${i + 1}`, text: `ตามหา iPad รุ่นทดสอบ ${i} มือสอง งบ 5000 บาท` })) });
}

describe.skipIf(!fixture.enabled)("real Postgres ingest → queue → provider → completion", () => {
  it("keeps request ingestion free of embedding calls and completes each AI job", async () => {
    process.env.MYBOT_PROCESS = "web";
    expect((await ingest()).inserted).toBe(2);
    expect(network).not.toHaveBeenCalled();
    expect(await processAiQueue()).toBe(0);
    process.env.MYBOT_PROCESS = "worker";
    expect(await processAiQueue()).toBe(2);
    expect(await prisma.aiJob.count({ where: { status: "done" } })).toBe(2);
    expect(await prisma.post.count({ where: { aiProvider: "ollama" } })).toBe(2);
    expect(network.mock.calls.some(([url]) => String(url).endsWith("/api/embed"))).toBe(false);
    const jobs = await prisma.aiJob.findMany();
    expect(jobs.every(job => job.queueWaitMs != null && job.latencyMs != null)).toBe(true);
  });

  it("only completes answered posts; preserves retry/backoff on startup and resets on manual retry", async () => {
    await ingest(); partial = true;
    await processAiQueue();
    expect(await prisma.aiJob.count({ where: { status: "done" } })).toBe(1);
    const pending = await prisma.aiJob.findFirstOrThrow({ where: { status: "pending" } });
    expect(pending.attempts).toBe(1);
    expect(pending.lastError).toContain("AI ตอบไม่ครบ");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: pending.postId } })).aiProvider).toBe("rules");
    await enqueueUnclassifiedPosts();
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: pending.id } })).nextAttemptAt).toEqual(pending.nextAttemptAt);
    await enqueueUnclassifiedPosts(true); partial = false;
    await processAiQueue();
    expect(await prisma.aiJob.count({ where: { status: "done" } })).toBe(2);
  });

  it("pauses repeated failures, preserves that pause at startup, and supports explicit retry", async () => {
    await ingest(1); providerDown = true;
    await prisma.aiJob.updateMany({ data: { attempts: MAX_AI_ATTEMPTS - 1 } });
    await processAiQueue();
    const job = await prisma.aiJob.findFirstOrThrow();
    expect(job.status).toBe("failed"); expect(job.lastError).toContain("ollama: HTTP 503");
    await enqueueUnclassifiedPosts();
    expect((await prisma.aiJob.findFirstOrThrow()).status).toBe("failed");
    await enqueueAiJobs([job.postId], true); providerDown = false;
    await processAiQueue();
    expect((await prisma.aiJob.findFirstOrThrow()).status).toBe("done");
  });

  it("does not retry when the owner intentionally chooses rules, and resumes after selecting AI", async () => {
    await ingest(1);
    await prisma.setting.update({ where: { key: "ai_provider" }, data: { value: "rules" } });
    await processAiQueue();
    expect((await prisma.aiJob.findFirstOrThrow()).status).toBe("skipped");
    expect(network).not.toHaveBeenCalled();
    await prisma.setting.update({ where: { key: "ai_provider" }, data: { value: "ollama" } });
    await processAiQueue();
    expect((await prisma.aiJob.findFirstOrThrow()).status).toBe("done");
  });

  it("recovers stale jobs, protects active jobs from manual reset, and drains batches without a minute wait", async () => {
    await ingest(12);
    const first = await prisma.aiJob.findFirstOrThrow();
    await prisma.aiJob.update({ where: { id: first.id }, data: { status: "running", updatedAt: new Date(Date.now() - 180_000) } });
    await enqueueAiJobs([first.postId], true);
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("running");
    expect(await processAiQueue()).toBe(10);
    expect(await processAiQueue()).toBe(2);
    expect(await processAiQueue()).toBe(0);
    expect(await prisma.aiJob.count({ where: { status: "done" } })).toBe(12);
  });

it("reuses matching vectors and retains old vectors with backoff if a changed model fails", async () => {
  await ingest(1);
  const post = await prisma.post.findFirstOrThrow();
  await backfillEmbeddings();
  const embedded = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  expect(embedded.embeddingKey).toContain("|");
  network.mockClear();
  await enrichPosts([post.id], [], await getSettings());
  expect(network).not.toHaveBeenCalled();
  await prisma.setting.update({ where: { key: "embed_model" }, data: { value: "new-model" } });
  embedDown = true;
  await backfillEmbeddings();
  const failed = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  expect(failed.embeddingJson).toBe(embedded.embeddingJson);
  expect(failed.embeddingConfig).toBe(embedded.embeddingConfig);
  expect(failed.embeddingRetryAt.getTime()).toBeGreaterThan(Date.now());
});

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
  expect(data.total).toBe(235); expect(data.posts).toHaveLength(25);
  expect(data.posts[0]).not.toHaveProperty("embeddingJson");
});

it("honors provider retry-after without blocking the batch with inline retries", async () => {
  await ingest(1); rateLimited = true;
  const start = Date.now();
  await processAiQueue();
  const job = await prisma.aiJob.findFirstOrThrow();
  expect(job.status).toBe("pending"); expect(job.attempts).toBe(1);
  expect(job.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(start + 120_000);
  expect(network.mock.calls.filter(([url]) => String(url).endsWith("/api/chat"))).toHaveLength(1);
});

it("queues outbound notifications during ingest and retries only channels not already delivered", async () => {
  await prisma.setting.createMany({ data: [{ key: "discord_webhook", value: "https://example.test/webhook" }, { key: "line_token", value: "fixture-token" }, { key: "line_user_id", value: "fixture-user" }] });
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
  expect(network.mock.calls.filter(([url]) => String(url) === "https://example.test/webhook")).toHaveLength(1);
  expect(await prisma.notification.count({ where: { channel: "line" } })).toBe(1);
});

it("clearly reports the semantic candidate limit and avoids ranking vectors from other models", async () => {
  const config = embeddingConfig(await getSettings());
  await prisma.post.createMany({ data: Array.from({ length: 1010 }, (_, i) => {
    const text = `ตามหา ipad ${i}`;
    return { sourceId: "source", externalUrl: `https://example.test/${i}`, text, normalizedText: text, contentHash: `semantic-${i}`, embeddingJson: "[0.3,0.7,0.2]", embeddingConfig: config, embeddingKey: `ollama:http://127.0.0.1:11434:bge-m3|${embeddingTextKey(text, config)}` };
  }) });
  const data = await (await search(new Request("http://localhost/api/posts?q=ipad&semantic=1"))).json();
  expect(data.semantic).toBe(true); expect(data.totalIsLimited).toBe(true);
  expect(data.searchScope).toContain("1000"); expect(data.posts).toHaveLength(30);
  await prisma.post.updateMany({ data: { embeddingKey: "other-model|old" } });
  const fallback = await (await search(new Request("http://localhost/api/posts?q=ipad&semantic=1"))).json();
  expect(fallback.semantic).toBe(false); expect(fallback.total).toBe(1010);
});

it("resets feedback centroids for a different embedding space without generating vectors in the request", async () => {
  await ingest(1); await backfillEmbeddings();
  const post = await prisma.post.findFirstOrThrow();
  await prisma.setting.createMany({ data: [{ key: "pref_liked_centroid", value: "[1,1,1]" }, { key: "pref_liked_count", value: "10" }, { key: "pref_liked_space", value: "different-model" }] });
  network.mockClear();
  await recordFeedback(post.id, "save");
  expect((await prisma.setting.findUniqueOrThrow({ where: { key: "pref_liked_count" } })).value).toBe("1");
  expect((await prisma.setting.findUniqueOrThrow({ where: { key: "pref_liked_centroid" } })).value).toBe(post.embeddingJson);
  expect(network).not.toHaveBeenCalled();
  await prisma.post.update({ where: { id: post.id }, data: { embeddingConfig: "old-config" } });
  await recordFeedback(post.id, "contacted");
  expect((await prisma.setting.findUniqueOrThrow({ where: { key: "pref_liked_count" } })).value).toBe("1");
});

it("repairs all exact-duplicate groups rather than stopping after the first 50", async () => {
  await prisma.post.createMany({ data: Array.from({ length: 102 }, (_, i) => ({ sourceId: "source", externalUrl: `https://example.test/${i}`, text: `same capture group number ${Math.floor(i / 2)}`, normalizedText: `same capture group number ${Math.floor(i / 2)}`, contentHash: `exact-${i}` })) });
  expect(await collapseIdenticalTexts()).toBe(51);
  expect(await prisma.post.count({ where: { duplicateOfId: { not: null } } })).toBe(51);
});
});
