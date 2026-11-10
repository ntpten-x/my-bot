import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  type Row = { id: string; text: string; normalizedText: string; truncated: boolean; forbiddenHit: boolean; textRevision: number; [key: string]: unknown };
  const rows: Row[] = [];
  const source = { id: "source", type: "facebook_group", url: "https://www.facebook.com/groups/12345", enabled: true };
  const db = {
    source: { findUnique: vi.fn(async () => source), update: vi.fn(async () => source) },
    category: { findMany: vi.fn(async () => [{ id: "other", slug: "other", name: "อื่นๆ", parentId: null, matchWords: "", sortOrder: 0 }]) },
    keyword: { findMany: vi.fn(async () => [{ word: "ปิดรับแล้ว", type: "forbidden" }]) },
    postTombstone: { findMany: vi.fn(async () => []) },
    post: {
      findMany: vi.fn(async () => structuredClone(rows)),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => { rows.push(...structuredClone(data).map(row => ({ ...row, textRevision: 0 }))); return { count: data.length }; }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; textRevision: number }; data: Record<string, unknown> }) => {
        const row = rows.find(row => row.id === where.id && row.textRevision === where.textRevision);
        if (!row) return { count: 0 };
        const revision = row.textRevision + 1;
        Object.assign(row, structuredClone(data), { textRevision: revision });
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async work => work(db));
  return { db, rows, source };
});
vi.mock("../../src/lib/prisma", () => ({ prisma: fixture.db }));
vi.mock("../../src/lib/settings", () => ({ getSettings: async () => ({ maxPostAgeHours: 24 }) }));
import { ingestPosts } from "../../src/lib/ingest";
import { explainCommentRule } from "../../src/lib/auto-comment/matching";

beforeEach(() => { fixture.rows.length = 0; vi.clearAllMocks(); });
const ingest = (text: string) => ingestPosts({
  sourceUrl: fixture.source.url, actor: "worker",
  posts: [{ url: "https://www.facebook.com/groups/12345/posts/8888/", text }],
}, { deferFinalize: true });

it.each(["new", "edited"])("retains a late exclusion in %s captures so comment rules can reject it", async mode => {
  if (mode === "edited") await ingest("หาช่างแอร์ ข้อความเดิม");
  const fullText = "หาช่างแอร์ " + "ก".repeat(9000) + " ปิดรับแล้ว";
  await ingest(fullText);
  const stored = fixture.rows[0];
  expect(stored.text).toBe(fullText);
  expect(stored.forbiddenHit).toBe(true);
  const rule = { enabled: true, pausedReason: "", deliveryMode: "extension", messageMode: "template", intentMode: "keyword", sourceIdsJson: '["source"]', keywords: "หาช่าง", excludeKeywords: "ปิดรับแล้ว", keywordMode: "any", startMinute: 0, endMinute: 1440, daysJson: "[0,1,2,3,4,5,6]", maxAgeHours: 24 };
  const result = explainCommentRule(rule, {
    text: stored.text, sourceId: "source", createdAt: new Date(), postedAt: null,
    processingState: "done", truncated: stored.truncated, forbiddenHit: stored.forbiddenHit,
    isAd: false, dismissed: false, duplicateOfId: null,
  });
  expect(result.matched).toBe(false);
  expect(result.checks.find(check => check.code === "excluded")?.passed).toBe(false);
});

it("retains the entire API-supported 20000-character capture", async () => {
  const text = "ก".repeat(20000);
  await ingest(text);
  expect(fixture.rows[0].text).toBe(text);
  expect(fixture.rows[0].truncated).toBe(false);
});

it("marks a clipped internal capture as incomplete instead of allowing a partial match", async () => {
  await ingest("หาช่างแอร์ " + "ก".repeat(20000) + " ปิดรับแล้ว");
  expect(fixture.rows[0].text.length).toBeLessThanOrEqual(20000);
  expect(fixture.rows[0].text.endsWith("…")).toBe(true);
  expect(fixture.rows[0].truncated).toBe(true);
});
