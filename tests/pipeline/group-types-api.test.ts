import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), children: vi.fn(), products: vi.fn(), templates: vi.fn(), unbind: vi.fn(), remove: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.auth }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, category: { update: mocks.update } } }));
import { DELETE, PATCH } from "../../src/app/api/categories/[id]/route";
const context = { params: Promise.resolve({ id: "category-1" }) };
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({}); mocks.find.mockResolvedValue({ id: "category-1", slug: "games" });
  mocks.children.mockResolvedValue(0); mocks.products.mockResolvedValue(0); mocks.templates.mockResolvedValue(0);
  mocks.transaction.mockImplementation(async fn => fn({ category: { findUnique: mocks.find, count: mocks.children, delete: mocks.remove }, product: { count: mocks.products }, replyTemplate: { count: mocks.templates }, source: { updateMany: mocks.unbind } }));
});
it("clears source bindings and deletes the category inside one transaction", async () => {
  const result = await DELETE(new Request("http://localhost"), context);
  expect(result.status).toBe(200);
  expect(mocks.unbind).toHaveBeenCalledWith({ where: { boundCategorySlug: "games" }, data: { boundCategorySlug: "" } });
  expect(mocks.remove).toHaveBeenCalledWith({ where: { id: "category-1" } });
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
});
it.each(["children", "products", "templates"] as const)("blocks deletion when %s still use the category", async dependency => {
  mocks[dependency].mockResolvedValue(1);
  expect((await DELETE(new Request("http://localhost"), context)).status).toBe(400);
  expect(mocks.unbind).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});
it("reports a missing category without modifying sources", async () => {
  mocks.find.mockResolvedValue(null);
  expect((await DELETE(new Request("http://localhost"), context)).status).toBe(404);
  expect(mocks.unbind).not.toHaveBeenCalled();
});
it("rejects whitespace names and preserves slug when renaming", async () => {
  const req = (name: string) => new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ name }) });
  expect((await PATCH(req("   "), context)).status).toBe(400);
  mocks.update.mockResolvedValue({ id: "category-1", slug: "games", name: "เกมใหม่" });
  expect((await PATCH(req(" เกมใหม่ "), context)).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "category-1" }, data: { name: "เกมใหม่", matchWords: undefined } });
});
it("requires authentication before deletion", async () => {
  mocks.auth.mockResolvedValue({ error: new Response(null, { status: 401 }) });
  expect((await DELETE(new Request("http://localhost"), context)).status).toBe(401);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
