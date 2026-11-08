import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), category: vi.fn(), product: vi.fn(), find: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.auth }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { category: { findUnique: mocks.category }, product: { findUnique: mocks.product }, replyTemplate: { findUnique: mocks.find, count: mocks.count, create: mocks.create, update: mocks.update } } }));
import { POST } from "../../src/app/api/templates/route";
import { PATCH } from "../../src/app/api/templates/[id]/route";
const request = (body: unknown) => new Request("http://localhost/api/templates", { method: "POST", body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: "message-1" }) };
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({}); mocks.category.mockResolvedValue({ id: "games", slug: "games", parent: null }); mocks.find.mockResolvedValue({ categoryId: "games", productId: null }); mocks.product.mockResolvedValue({ categorySlug: "games" }); mocks.count.mockResolvedValue(0);
  mocks.create.mockImplementation(async ({ data }) => ({ id: "message-1", ...data })); mocks.update.mockResolvedValue({ id: "message-1" });
});
it("stores multiple named messages in the same category without restricting them to individual groups", async () => {
  for (const name of ["แนะนำร้าน", "โปรโมชัน"]) {
    expect((await POST(request({ categoryId: "games", name, body: "สวัสดีครับ สนใจสอบถามได้ครับ" }))).status).toBe(200);
  }
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ categoryId: "games", name: "โปรโมชัน", sourceIds: "", productId: null }) });
});
it("rejects a missing category on create and move", async () => {
  mocks.category.mockResolvedValue(null);
  expect((await POST(request({ categoryId: "missing", name: "ร้าน", body: "ข้อความ" }))).status).toBe(400);
  expect((await PATCH(request({ categoryId: "missing" }), context)).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it("allows editing and moving a message without resetting its other settings", async () => {
  expect((await PATCH(request({ categoryId: "food", name: "อาหาร", body: "เมนูใหม่" }), context)).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "message-1" }, data: { categoryId: "food", name: "อาหาร", body: "เมนูใหม่" } });
});
it.each([{ name: "   ", body: "ข้อความ" }, { name: "ชื่อ", body: "   " }, { name: "ชื่อ", body: "ก".repeat(2001) }])("validates message content %j", async body => {
  expect((await POST(request(body))).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
});
it("requires a signed-in owner", async () => {
  mocks.auth.mockResolvedValue({ error: new Response(null, { status: 401 }) });
  expect((await POST(request({ categoryId: "games", name: "ร้าน", body: "ข้อความ" }))).status).toBe(401);
  expect(mocks.create).not.toHaveBeenCalled();
});

it("creates and edits type-specific messages, rejecting cross-category types", async () => {
  expect((await POST(request({ categoryId: "games", productId: "roblox", name: "Roblox", body: "ข้อความ Roblox" }))).status).toBe(200);
  expect(mocks.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ categoryId: "games", productId: "roblox" }) });
  mocks.product.mockResolvedValue({ categorySlug: "it" });
  expect((await POST(request({ categoryId: "games", productId: "phone", name: "มือถือ", body: "ข้อความ" }))).status).toBe(400);
  expect((await PATCH(request({ productId: "phone" }), context)).status).toBe(400);
});
it("validates the existing type when changing only a message category", async () => {
  mocks.find.mockResolvedValue({ categoryId: "games", productId: "roblox" });
  mocks.category.mockResolvedValue({ id: "it", slug: "it", parent: null });
  expect((await PATCH(request({ categoryId: "it" }), context)).status).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
});
