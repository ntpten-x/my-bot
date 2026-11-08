// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GroupsPage from "../../src/app/(app)/groups/page";
import MessagesPage from "../../src/app/(app)/messages/page";
const categories = [ { id: "games", name: "เกม", slug: "games", parentId: null }, { id: "it", name: "ไอที", slug: "it", parentId: null } ];
const products = [ { id: "roblox", name: "Roblox", categorySlug: "games", enabled: true }, { id: "phone", name: "มือถือ", categorySlug: "it", enabled: true } ];
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method) return new Response(JSON.stringify({ created: 1, skipped: [] }));
    const data = url === "/api/categories" ? { categories } : url === "/api/products" ? { products } : url === "/api/templates" ? { templates: [{ id: "old", name: "ข้อความเดิม", body: "ใช้ทั้งหมวดหมู่", categoryId: "games", productId: null, sourceIds: "" }], max: 300 } : { sources: [{ id: "group1", type: "facebook_group", name: "กลุ่มเดิม", url: "https://facebook.com/groups/123", enabled: true, boundCategorySlug: "games", defaultProductId: "roblox", postCount: 3 }] };
    return new Response(JSON.stringify(data));
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function select(id: string, value: string) {
  await act(async () => { const node = container.querySelector<HTMLSelectElement>(`#${id}`)!; node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function input(id: string, value: string) {
  await act(async () => {
    const node = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
    const proto = node.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("limits type choices to their parent and clears the previous type on category changes", async () => {
  await act(async () => root.render(React.createElement(GroupsPage)));
  await select("add-group-category", "games"); await select("add-group-type", "roblox");
  expect(container.querySelector<HTMLSelectElement>("#add-group-type")!.value).toBe("roblox");
  await select("add-group-category", "it");
  const type = container.querySelector<HTMLSelectElement>("#add-group-type")!;
  expect(type.value).toBe(""); expect(type.textContent).toContain("มือถือ"); expect(type.textContent).not.toContain("Roblox");
});
it("saves a group's category and type together only after the owner chooses the new type", async () => {
  await act(async () => root.render(React.createElement(GroupsPage)));
  await select("group-group1-category", "it");
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  await select("group-group1-type", "phone");
  const form = container.querySelector("#group-group1-type")!.closest("form")!;
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(fetch).toHaveBeenCalledWith("/api/sources/group1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ boundCategorySlug: "it", defaultProductId: "phone" }) }));
});
it("preserves old category-wide messages and creates a new type-specific message", async () => {
  await act(async () => root.render(React.createElement(MessagesPage)));
  expect(container.textContent).toContain("ข้อความเดิม"); expect(container.textContent).toContain("เกม / ทุกประเภท");
  await select("message-category", "games"); await select("message-type", "roblox");
  await input("message-name", "ซื้อขาย Roblox"); await input("message-body", "สนใจสอบถามได้ครับ");
  const form = container.querySelector("#message-name")!.closest("form")!;
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(fetch).toHaveBeenCalledWith("/api/templates", expect.objectContaining({ method: "POST", body: JSON.stringify({ categoryId: "games", productId: "roblox", name: "ซื้อขาย Roblox", body: "สนใจสอบถามได้ครับ" }) }));
});
