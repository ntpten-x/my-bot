import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authed: vi.fn(), category: vi.fn(), product: vi.fn(), create: vi.fn(), settings: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { category: { findFirst: mocks.category }, product: { findUnique: mocks.product }, source: { create: mocks.create } } }));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.authed }));
vi.mock("../../src/lib/settings", () => ({ getSettings: mocks.settings }));
vi.mock("../../src/lib/coverage-data", () => ({ coverageBySource: vi.fn() }));
import { POST } from "../../src/app/api/sources/route";
const request = (body: unknown) => new Request("http://localhost/api/sources", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.authed.mockResolvedValue({}); mocks.category.mockResolvedValue({ slug: "games" }); mocks.product.mockResolvedValue({ id: "roblox", categorySlug: "games" });
  mocks.settings.mockResolvedValue({ fetchIntervalMinutes: 10 }); mocks.create.mockResolvedValue({ id: "group-1" });
});
it("creates canonical groups with the chosen category and preserves scheduling defaults", async () => {
  const response = await POST(request({ urls: "https://m.facebook.com/groups/123/posts/456?ref=share", name: "เกม", type: "facebook_group", boundCategorySlug: "games" }));
  expect(await response.json()).toEqual({ created: 1, skipped: [] });
  expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ url: "https://www.facebook.com/groups/123", boundCategorySlug: "games", intervalMinutes: 10, priority: "normal", name: "เกม" }) });
});
it("rejects missing categories before creating any group", async () => {
  mocks.category.mockResolvedValue(null);
  expect((await POST(request({ urls: "https://www.facebook.com/groups/123", boundCategorySlug: "missing" }))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("rejects lookalike hosts, credentials, non-group URLs and non-http schemes", async () => {
  const urls = ["https://evilfacebook.com/groups/123", "https://facebook.com.evil.test/groups/123", "https://evil.test/facebook.com/groups/123", "https://user@facebook.com/groups/123", "https://facebook.com/marketplace", "ftp://facebook.com/groups/123"];
  const response = await POST(request({ urls: urls.join("\n"), type: "facebook_group" }));
  expect(await response.json()).toEqual({ created: 0, skipped: urls }); expect(mocks.create).not.toHaveBeenCalled();
});
it("requires an owner session", async () => {
  mocks.authed.mockResolvedValue({ error: new Response(null, { status: 401 }) });
  expect((await POST(request({ urls: "https://facebook.com/groups/123" }))).status).toBe(401);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("leaves duplicate links available to correct and accepts unassigned groups", async () => {
  mocks.create.mockRejectedValueOnce(new Error("duplicate")).mockResolvedValueOnce({ id: "group-2" });
  const response = await POST(request({ urls: "https://facebook.com/groups/123\nhttps://facebook.com/groups/456", type: "facebook_group" }));
  expect(await response.json()).toEqual({ created: 1, skipped: ["https://facebook.com/groups/123"] });
  expect(mocks.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ boundCategorySlug: "" }) });
});

it("stores type and category for every group in a multi-link request", async () => {
  const response = await POST(request({ urls: "https://facebook.com/groups/123\nhttps://facebook.com/groups/456", type: "facebook_group", boundCategorySlug: "games", defaultProductId: "roblox" }));
  expect(await response.json()).toEqual({ created: 2, skipped: [] });
  for (const call of mocks.create.mock.calls) expect(call[0].data).toMatchObject({ boundCategorySlug: "games", defaultProductId: "roblox" });
});
it("rejects a type in another category before creating groups", async () => {
  mocks.product.mockResolvedValue({ id: "phone", categorySlug: "it" });
  expect((await POST(request({ urls: "https://facebook.com/groups/123", boundCategorySlug: "games", defaultProductId: "phone" }))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
