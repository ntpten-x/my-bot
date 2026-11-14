import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), posts: vi.fn(), count: vi.fn(), provinces: vi.fn(),
  notifications: vi.fn(), unread: vi.fn(), categories: vi.fn(), sources: vi.fn(), keywords: vi.fn(),
}));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.auth }));
vi.mock("../../src/lib/prisma", () => ({ prisma: {
  post: { findMany: mocks.posts, count: mocks.count, groupBy: mocks.provinces },
  notification: { findMany: mocks.notifications, count: mocks.unread },
  category: { findMany: mocks.categories }, source: { findMany: mocks.sources }, keyword: { findMany: mocks.keywords },
} }));
import { GET as meta } from "../../src/app/api/meta/route";
import { GET as notifications } from "../../src/app/api/notifications/route";
import { GET as posts } from "../../src/app/api/posts/route";
import { serializePost, type PostRecord } from "../../src/lib/serialize";

const fixture: PostRecord & { embeddingJson: string; normalizedText: string } = {
  id: "synthetic", text: "ต้องการช่างซ่อมบ้าน", authorName: "Owner", externalUrl: "https://example.invalid/post",
  postedAt: new Date("2026-11-11T23:00:00Z"), createdAt: new Date("2026-11-12T00:00:00Z"), imagesJson: '["https://example.invalid/image"]', intent: "buyer",
  province: "กรุงเทพมหานคร", isAd: false, isRead: false, isSaved: true, forbiddenHit: false,
  keywordHitsJson: '["ช่าง"]', pipelineStatus: "contacted", suggestedReply: "สวัสดีครับ", aiProvider: "rules",
  score: 70, scoreReason: "ตรงคำค้น", duplicateOfId: null, dismissed: false, ocrText: "โทร 0812345678",
  category: { id: "category", name: "บริการ", slug: "services" },
  subcategory: { id: "subcategory", name: "ซ่อมบ้าน", slug: "repairs" },
  source: { id: "source", name: "กลุ่มสังเคราะห์", url: "https://example.invalid/group", type: "facebook_group" },
  product: { id: "product", name: "ช่าง", slug: "technician" }, productBy: "rules",
  extraUrlsJson: '["https://example.invalid/also"]', followUpAt: new Date("2026-11-13T00:00:00Z"),
  statusChangedAt: new Date("2026-11-12T01:00:00Z"), repliedAt: new Date("2026-11-12T02:00:00Z"),
  notes: [{ id: "note", body: "รอรายละเอียด", createdAt: new Date("2026-11-12T00:00:00Z") }],
  embeddingJson: JSON.stringify(Array.from({ length: 1024 }, (_, i) => i / 1024)),
  normalizedText: "ต้องการช่างซ่อมบ้าน",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ error: null });
  mocks.categories.mockResolvedValue([]); mocks.sources.mockResolvedValue([]); mocks.keywords.mockResolvedValue([]);
  mocks.posts.mockImplementation(async (args) => {
    if (!args.select) return [fixture];
    return [Object.fromEntries(Object.entries(fixture).filter(([key]) => key in args.select))];
  });
  mocks.count.mockResolvedValue(1);
  mocks.provinces.mockResolvedValue([{ province: "กรุงเทพมหานคร" }]);
  mocks.notifications.mockResolvedValue([]); mocks.unread.mockResolvedValue(7);
});

it("gets unique provinces in the database without transferring one row per post", async () => {
  const response = await meta();
  expect((await response.json()).provinces).toEqual(["กรุงเทพมหานคร"]);
  expect(mocks.provinces).toHaveBeenCalledWith({ by: ["province"], where: { province: { not: null } } });
  expect(mocks.posts).not.toHaveBeenCalled();
});

it("loads just the unread count for the shared navigation badge", async () => {
  const response = await notifications(new Request("http://localhost/api/notifications?countOnly=1"));
  expect(await response.json()).toEqual({ unread: 7 });
  expect(mocks.notifications).not.toHaveBeenCalled();
  expect(mocks.unread).toHaveBeenCalledWith({ where: { read: false, channel: "in_app" } });
});

it("keeps the normal notification history response intact", async () => {
  const response = await notifications(new Request("http://localhost/api/notifications"));
  expect(await response.json()).toEqual({ unread: 7, notifications: [] });
  expect(mocks.notifications).toHaveBeenCalledTimes(1);
});

it("still authenticates before performing any optimized reads", async () => {
  mocks.auth.mockResolvedValue({ error: new Response("unauthorized", { status: 401 }) });
  expect((await meta()).status).toBe(401);
  expect((await notifications(new Request("http://localhost/api/notifications?countOnly=1"))).status).toBe(401);
  expect((await posts(new Request("http://localhost/api/posts"))).status).toBe(401);
  expect(mocks.posts).not.toHaveBeenCalled(); expect(mocks.provinces).not.toHaveBeenCalled();
  expect(mocks.unread).not.toHaveBeenCalled(); expect(mocks.categories).not.toHaveBeenCalled();
});

it.each(["", "&q=ช่าง"])("preserves serialized post fields while omitting internal vectors (%s)", async (search) => {
  const response = await posts(new Request(`http://localhost/api/posts?page=1${search}`));
  const result = await response.json();
  expect(result.posts).toEqual([serializePost(fixture)]);
  const query = mocks.posts.mock.calls[0][0];
  expect(query.select).toBeDefined();
  expect(query.select.embeddingJson).toBeUndefined();
  expect(query.select.normalizedText).toBeUndefined();
  expect(query.select.ocrText).toBe(true); // Contact extraction still needs OCR text.
  expect(query.select.notes).toBeDefined();
});

it("rejects excessive offsets, malformed dates and expensive input before querying posts", async () => {
  for (const query of ["page=9007199254740991", "from=not-a-date", "minScore=NaN", "minScore=101", `q=${"x".repeat(201)}`]) {
    const response = await posts(new Request(`http://localhost:8001/api/posts?${query}`));
    expect(response.status).toBe(400);
  }
  expect(mocks.posts).not.toHaveBeenCalled(); expect(mocks.count).not.toHaveBeenCalled();
});
