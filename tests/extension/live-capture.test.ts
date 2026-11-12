import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const source = readFileSync("extension/content.js", "utf8");
const cleanups: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.useRealTimers(); });
function harness(count = 1) {
  const dom = new JSDOM("<main></main>", { url: "https://www.facebook.com/groups/12345/" });
  Object.defineProperty(dom.window.document, "visibilityState", { value: "visible", configurable: true });
  const add = (id: number, text = "synthetic") => {
    const article = dom.window.document.createElement("article"); article.setAttribute("data-id", String(id));
    article.textContent = text; dom.window.document.querySelector("main")!.append(article); return article;
  };
  for (let i = 1; i <= count; i++) add(i);
  let reply: object = { ok: true, accepted: true };
  let storageChanged: (changes: object, area: string) => void = () => {};
  const messages: { at: number; sourceUrl: string; captureScope?: { apiBase: string; fbUserId: string }; posts: { url: string; text: string; observedAt: number }[] }[] = [];
  const local = { apiBase: "https://owner.example", token: "synthetic", fbIdentity: { loggedIn: true, id: "12345" } } as Record<string, unknown>;
  const parse = vi.fn((_doc?: Document, nodes?: Element[]) => [...(nodes ?? dom.window.document.querySelectorAll("article"))].map(el => ({
    url: `https://www.facebook.com${dom.window.location.pathname.replace(/\/$/, "")}/posts/${el.getAttribute("data-id")}/`, text: el.textContent, images: [],
  })));
  const context = vm.createContext({ Date, Map, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    window: dom.window, document: dom.window.document, location: dom.window.location, MutationObserver: dom.window.MutationObserver,
    MyBotScrape: { postKey: url => url }, MyBotParser: { parseFacebookPosts: parse,
      SELECTORS: { article: ["article", '[data-ad-preview="message"]'] },
      collectArticles: (root: ParentNode) => [...root.querySelectorAll('article,[data-ad-preview="message"]')],
    },
    chrome: { runtime: { sendMessage: (body, callback) => { messages.push({ at: Date.now(), sourceUrl: body.sourceUrl, captureScope: body.captureScope, posts: body.posts }); callback(reply); } },
      storage: { local: { get: async defaults => ({ ...defaults, ...local }) }, onChanged: { addListener: fn => { storageChanged = fn; } } } },
  });
  vm.runInContext(source, context);
  cleanups.push(() => { dom.window.dispatchEvent(new dom.window.Event("pagehide")); dom.window.close(); });
  return { dom, add, parse, messages, storageChanged: (data: object) => {
    for (const [key, change] of Object.entries(data)) local[key] = change.newValue;
    storageChanged(data, "local");
  }, reply: (value: object) => { reply = value; } };
}

it("captures a DOM-added post without scrolling, within a coalesced half-second wake", async () => {
  const h = harness(); await vi.advanceTimersByTimeAsync(1100);
  const at = Date.now(); h.add(2);
  await vi.advanceTimersByTimeAsync(600);
  expect(h.messages).toHaveLength(2);
  expect(h.messages[1].posts.map(post => post.url)).toEqual(["https://www.facebook.com/groups/12345/posts/2/"]);
  expect(h.messages[1].at - at).toBeLessThanOrEqual(600);
});

it("detects changed fallback message containers without waiting for the full repair scan", async () => {
  const h = harness();
  const fallback = h.dom.window.document.createElement("div");
  fallback.setAttribute("data-ad-preview", "message"); fallback.setAttribute("data-id", "1"); fallback.textContent = "synthetic fallback";
  h.dom.window.document.querySelector("main")!.replaceChildren(fallback);
  await vi.advanceTimersByTimeAsync(1100);
  fallback.textContent = "synthetic fallback expanded";
  await vi.advanceTimersByTimeAsync(600);
  expect(h.messages).toHaveLength(2); expect(h.messages[1].posts[0].text).toBe("synthetic fallback expanded");
});
it("coalesces mutation bursts and forwards changed text without repeating unchanged posts", async () => {
  const h = harness(); await vi.advanceTimersByTimeAsync(1100);
  for (let i = 2; i <= 10; i++) h.add(i);
  await vi.advanceTimersByTimeAsync(600);
  expect(h.parse).toHaveBeenCalledTimes(2);
  h.dom.window.document.querySelector("article")!.textContent = "synthetic expanded text";
  await vi.advanceTimersByTimeAsync(600);
  expect(h.messages[2].posts).toHaveLength(1);
  expect(h.messages[2].posts[0].text).toBe("synthetic expanded text");
});
it("requires a durable acknowledgement, preserves the first observation time and retries failures", async () => {
  const h = harness(); h.reply({ ok: false }); await vi.advanceTimersByTimeAsync(1100);
  const first = h.messages[0].posts[0].observedAt;
  h.reply({ ok: true }); await vi.advanceTimersByTimeAsync(2100); // Old servers without accepted cannot acknowledge.
  expect(h.messages).toHaveLength(2);
  expect(h.messages[1].posts[0].observedAt).toBe(first);
  h.reply({ ok: true, accepted: true }); await vi.advanceTimersByTimeAsync(2100);
  await vi.advanceTimersByTimeAsync(15000);
  expect(h.messages).toHaveLength(3);
});
it("drains a large rendered snapshot in batches <=40 without dropping the overflow", async () => {
  const h = harness(350); await vi.advanceTimersByTimeAsync(4000);
  const urls = h.messages.flatMap(row => row.posts.map(post => post.url));
  expect(new Set(urls).size).toBe(350);expect(urls).toHaveLength(350);
  expect(h.messages.every(row => row.posts.length <= 40)).toBe(true);
});
it("does not clear capture dedupe for heartbeat-only timestamp changes", async () => {
  const h = harness(); await vi.advanceTimersByTimeAsync(1100);
  h.storageChanged({ fbIdentity: { oldValue: { id: "12345", loggedIn: true, at: 1 }, newValue: { id: "12345", loggedIn: true, at: 2 } } });
  await vi.advanceTimersByTimeAsync(16000);
  expect(h.messages).toHaveLength(1);
});
it("rechecks after account/server changes and cooperates with worker-owned readers", async () => {
  const h = harness(); h.reply({ ok: true, accepted: false, managedReader: true }); await vi.advanceTimersByTimeAsync(1100);
  h.add(2); await vi.advanceTimersByTimeAsync(600);
  expect(h.messages).toHaveLength(1);
  h.reply({ ok: true, accepted: true }); h.storageChanged({ apiBase: { oldValue: "https://old.example", newValue: "https://new.example" } });
  await vi.advanceTimersByTimeAsync(200);
  expect(h.messages[1].posts).toHaveLength(2);
});
it("stops timers while hidden in bfcache and restarts capture after restoration", async () => {
  const h = harness(); await vi.advanceTimersByTimeAsync(1100);
  h.dom.window.dispatchEvent(new h.dom.window.Event("pagehide")); h.add(2); await vi.advanceTimersByTimeAsync(16000);
  expect(h.messages).toHaveLength(1);
  const event = new h.dom.window.Event("pageshow");Object.defineProperty(event,"persisted",{value:true});h.dom.window.dispatchEvent(event);
  await vi.advanceTimersByTimeAsync(200);
  expect(h.messages[1].posts).toHaveLength(1);
});

it("suspends all capture wake timers while the tab is hidden and repairs on return", async () => {
  const h = harness(); await vi.advanceTimersByTimeAsync(1100);
  Object.defineProperty(h.dom.window.document, "visibilityState", { value: "hidden", configurable: true });
  h.dom.window.document.dispatchEvent(new h.dom.window.Event("visibilitychange"));
  h.add(2);
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.parse).toHaveBeenCalledTimes(1);
  Object.defineProperty(h.dom.window.document, "visibilityState", { value: "visible", configurable: true });
  h.dom.window.document.dispatchEvent(new h.dom.window.Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(200);
  expect(h.messages[1].posts[0].url).toContain("/posts/2/");
});

it("retains unacknowledged posts and their observation time across hidden tabs", async () => {
  const h = harness(); h.reply({ ok: false }); await vi.advanceTimersByTimeAsync(1100);
  const first = h.messages[0].posts[0].observedAt;
  Object.defineProperty(h.dom.window.document, "visibilityState", { value: "hidden", configurable: true });
  h.dom.window.document.dispatchEvent(new h.dom.window.Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000);
  h.reply({ ok: true, accepted: true });
  Object.defineProperty(h.dom.window.document, "visibilityState", { value: "visible", configurable: true });
  h.dom.window.document.dispatchEvent(new h.dom.window.Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(200);
  expect(h.messages).toHaveLength(2);
  expect(h.messages[1].posts[0].observedAt).toBe(first);
});

it("retains unacknowledged source A when a SPA navigation starts source B", async () => {
  const h = harness(); h.reply({ ok: false }); await vi.advanceTimersByTimeAsync(1100);
  const first = h.messages[0].posts[0].observedAt;
  h.dom.window.history.pushState({}, "", "/groups/67890/");
  h.dom.window.document.querySelector("main")!.textContent = ""; h.add(2);
  h.reply({ ok: true, accepted: true }); await vi.advanceTimersByTimeAsync(4000);
  const retried = h.messages.slice(1).find(message => message.sourceUrl.endsWith("/12345"));
  expect(retried?.posts[0].observedAt).toBe(first);
  expect(h.messages.some(message => message.sourceUrl.endsWith("/67890"))).toBe(true);
});

it("scopes retained captures to the original server and account", async () => {
  const h = harness(); h.reply({ ok: false }); await vi.advanceTimersByTimeAsync(1100);
  const first = h.messages[0].posts[0].observedAt;
  h.storageChanged({ apiBase: { oldValue: "https://owner.example", newValue: "https://other.example" } });
  h.reply({ ok: true, accepted: true }); await vi.advanceTimersByTimeAsync(2300);
  expect(h.messages.at(-1)?.captureScope).toEqual({ apiBase: "https://other.example", fbUserId: "12345" });
  expect(h.messages.at(-1)?.posts[0].observedAt).toBeGreaterThan(first);
  h.storageChanged({ apiBase: { oldValue: "https://other.example", newValue: "https://owner.example" } });
  await vi.advanceTimersByTimeAsync(2300);
  expect(h.messages.at(-1)?.captureScope?.apiBase).toBe("https://owner.example");
  expect(h.messages.at(-1)?.posts[0].observedAt).toBe(first);
});

it("parses bounded slices and re-reads only the article changed by a mutation", async () => {
  const h = harness(100); await vi.advanceTimersByTimeAsync(4000);
  expect(h.parse.mock.calls.every(([, nodes]) => nodes && nodes.length <= 12)).toBe(true);
  const before = h.parse.mock.calls.length;
  h.dom.window.document.querySelector("article")!.textContent = "updated synthetic article";
  await vi.advanceTimersByTimeAsync(600);
  expect(h.parse.mock.calls.slice(before).reduce((sum, [, nodes]) => sum + (nodes?.length ?? 100), 0)).toBe(1);
});

it("does not reparse the whole DOM just to retry a pending transport batch", async () => {
  const h = harness(); h.reply({ ok: false }); await vi.advanceTimersByTimeAsync(1100);
  await vi.advanceTimersByTimeAsync(2100);
  expect(h.messages).toHaveLength(2); expect(h.parse).toHaveBeenCalledTimes(1);
});

it("keeps a full old context without starving the new account, then drains the old context on return", async () => {
  const h = harness(300); h.reply({ ok: false }); await vi.advanceTimersByTimeAsync(5000);
  expect(new Set(h.messages.flatMap(message => message.posts.map(post => post.url))).size).toBeGreaterThan(0);
  h.storageChanged({ fbIdentity: { oldValue: { id: "12345", loggedIn: true }, newValue: { id: "67890", loggedIn: true } } });
  const before = h.messages.length;
  h.reply({ ok: true, accepted: true }); await vi.advanceTimersByTimeAsync(5000);
  const next = h.messages.slice(before).filter(message => message.captureScope?.fbUserId === "67890");
  expect(new Set(next.flatMap(message => message.posts.map(post => post.url))).size).toBe(300);
  h.storageChanged({ fbIdentity: { oldValue: { id: "67890", loggedIn: true }, newValue: { id: "12345", loggedIn: true } } });
  const returnedAt = h.messages.length;
  await vi.advanceTimersByTimeAsync(5000);
  const old = h.messages.slice(returnedAt).filter(message => message.captureScope?.fbUserId === "12345");
  expect(new Set(old.flatMap(message => message.posts.map(post => post.url))).size).toBe(300);
});

it("bounds pending across offline contexts without evicting them and resumes after capacity returns", async () => {
  const h = harness(300); h.reply({ ok: false });
  const switchAccount = (from: string, to: string) => h.storageChanged({ fbIdentity: {
    oldValue: { id: from, loggedIn: true }, newValue: { id: to, loggedIn: true },
  } });
  await vi.advanceTimersByTimeAsync(5000);
  for (let account = 2; account <= 4; account++) {
    switchAccount(`${account - 1}2345`, `${account}2345`);
    await vi.advanceTimersByTimeAsync(5000);
  }
  switchAccount("42345", "52345");
  h.parse.mockClear(); const before = h.messages.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.parse).not.toHaveBeenCalled(); expect(h.messages).toHaveLength(before);
  switchAccount("52345", "12345"); h.reply({ ok: true, accepted: true });
  const returned = h.messages.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(new Set(h.messages.slice(returned).flatMap(message => message.posts.map(post => post.url))).size).toBe(300);
  switchAccount("12345", "52345");
  const resumed = h.messages.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(new Set(h.messages.slice(resumed).flatMap(message => message.posts.map(post => post.url))).size).toBe(300);
});
