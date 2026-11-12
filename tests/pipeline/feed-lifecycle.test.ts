import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), open: vi.fn(), close: vi.fn() }));
vi.mock("../../src/components/api", () => ({ api: mocks.request, ApiError: class extends Error {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/feed", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../src/components/product-bar", () => ({
  useProductBar: () => ({}), FollowedProducts: () => null,
  ProductTabs: ({ onChange }: { onChange: (value: string) => void }) =>
    React.createElement("button", { onClick: () => onChange("synthetic-product") }, "filter"),
}));
import FeedPage from "../../src/app/(app)/feed/page";
import { Shell } from "../../src/components/shell";
import AccountsPage from "../../src/app/(app)/accounts/page";

let dom: JSDOM;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/feed" });
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("self", dom.window);
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", class {
    constructor() { mocks.open(); }
    close() { mocks.close(); }
  });
  mocks.request.mockResolvedValue({ posts: [], total: 0, categories: [], sources: [], keywords: [], provinces: [], settings: { notifySound: false } });
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close(); vi.unstubAllGlobals();
});

it("keeps one live connection across sound initialization and filter changes", async () => {
  await act(async () => root.render(React.createElement(FeedPage)));
  expect(mocks.open).toHaveBeenCalledTimes(1);
  await act(async () => {
    const button = [...document.querySelectorAll("button")].find(item => item.textContent === "filter")!;
    button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  expect(mocks.open).toHaveBeenCalledTimes(1);
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.request.mock.calls.some(([url]) => String(url).includes("productId=synthetic-product"))).toBe(true);
});

it("aborts obsolete feed requests on filter change and aborts the last request on unmount", async () => {
  const signals: AbortSignal[] = [];
  const finish: (() => void)[] = [];
  mocks.request.mockImplementation((url: string, init?: RequestInit) => {
    if (!url.startsWith("/api/posts?")) return Promise.resolve({ categories: [], keywords: [], sources: [], provinces: [], settings: { notifySound: false } });
    signals.push(init?.signal as AbortSignal);
    return new Promise(resolve => { finish.push(() => resolve({ posts: [], total: 0 })); });
  });
  await act(async () => root.render(React.createElement(FeedPage)));
  await act(async () => {
    [...document.querySelectorAll("button")].find(item => item.textContent === "filter")!
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  expect(signals[0]?.aborted).toBe(true);
  expect(signals.at(-1)?.aborted).toBe(false);
  await act(async () => { root.unmount(); finish.forEach(resolve => resolve()); });
  expect(signals.at(-1)?.aborted).toBe(true);
  expect(mocks.close).toHaveBeenCalledTimes(1);
});

it("does not overlap a slow navigation badge read when visibility changes", async () => {
  let finish!: () => void;
  mocks.request.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ unread: 3 }); }));
  await act(async () => root.render(React.createElement(Shell, null, "content")));
  expect(mocks.request.mock.calls[0][0]).toBe("/api/notifications?countOnly=1");
  await act(async () => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new dom.window.Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new dom.window.Event("visibilitychange"));
  });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});

it("defers background account polling until the page becomes visible", async () => {
  Object.defineProperty(document, "hidden", { value: true, configurable: true });
  mocks.request.mockResolvedValue({ accounts: [], checkedAt: new Date().toISOString() });
  await act(async () => root.render(React.createElement(AccountsPage)));
  expect(mocks.request).not.toHaveBeenCalled();
  await act(async () => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new dom.window.Event("visibilitychange"));
  });
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
