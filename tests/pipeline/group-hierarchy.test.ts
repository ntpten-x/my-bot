import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), category: vi.fn(), product: vi.fn(), current: vi.fn(), update: vi.fn(), transaction: vi.fn(), templates: vi.fn(), unbind: vi.fn(), remove: vi.fn(), clear: vi.fn() }));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.auth }));
vi.mock("../../src/lib/products", () => ({ clearProductCache: mocks.clear }));
vi.mock("../../src/lib/prisma", () => ({ prisma: {
  category: { findFirst: mocks.category }, product: { findUnique: mocks.product },
  source: { findUnique: mocks.current, update: mocks.update }, $transaction: mocks.transaction,
} }));
import { PATCH } from "../../src/app/api/sources/[id]/route";
import { DELETE } from "../../src/app/api/products/[id]/route";
const context = { params: Promise.resolve({ id: "group-1" }) };
const req = (body: unknown) => new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({}); mocks.category.mockResolvedValue({ slug: "games" });
  mocks.current.mockResolvedValue({ boundCategorySlug: "games", defaultProductId: "roblox" });
  mocks.product.mockResolvedValue({ id: "roblox", categorySlug: "games" }); mocks.templates.mockResolvedValue(0);
  mocks.update.mockImplementation(async ({ data }) => ({ id: "group-1", ...data }));
  mocks.transaction.mockImplementation(async fn => fn({ product: { findUnique: mocks.product, delete: mocks.remove }, replyTemplate: { count: mocks.templates }, source: { updateMany: mocks.unbind } }));
});
it("rejects mismatched explicit category and type without updating the group", async () => {
  expect((await PATCH(req({ boundCategorySlug: "it", defaultProductId: "roblox" }), context)).status).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("clears an old type when a legacy caller changes only the category", async () => {
  expect((await PATCH(req({ boundCategorySlug: "it" }), context)).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "group-1" }, data: { boundCategorySlug: "it", defaultProductId: null } });
});
it("permits selecting another type within the stored category", async () => {
  expect((await PATCH(req({ defaultProductId: "rov" }), context)).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "group-1" }, data: { boundCategorySlug: "games", defaultProductId: "rov" } });
});
it("does not read or reset classification when pausing a group", async () => {
  expect((await PATCH(req({ enabled: false }), context)).status).toBe(200);
  expect(mocks.current).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "group-1" }, data: { enabled: false } });
});
it("rejects a missing type and a missing source", async () => {
  mocks.product.mockResolvedValue(null);
  expect((await PATCH(req({ defaultProductId: "missing" }), context)).status).toBe(400);
  mocks.current.mockResolvedValue(null);
  expect((await PATCH(req({ defaultProductId: "missing" }), context)).status).toBe(404);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("deletes a type and unbinds its groups in one transaction, preserving their categories", async () => {
  expect((await DELETE(req({}), { params: Promise.resolve({ id: "roblox" }) })).status).toBe(200);
  expect(mocks.unbind).toHaveBeenCalledWith({ where: { defaultProductId: "roblox" }, data: { defaultProductId: null } });
  expect(mocks.remove).toHaveBeenCalledWith({ where: { id: "roblox" } }); expect(mocks.clear).toHaveBeenCalled();
});
it("blocks deleting types with messages to avoid broadening their scope", async () => {
  mocks.templates.mockResolvedValue(1);
  expect((await DELETE(req({}), context)).status).toBe(400);
  expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.unbind).not.toHaveBeenCalled();
});
it("requires authentication for deleting types", async () => {
  mocks.auth.mockResolvedValue({ error: new Response(null, { status: 401 }) });
  expect((await DELETE(req({}), context)).status).toBe(401); expect(mocks.transaction).not.toHaveBeenCalled();
});
