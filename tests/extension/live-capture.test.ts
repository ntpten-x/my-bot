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
  const messages: { at: number; posts: { url: string; text: string; observedAt: number }[] }[] = [];
  const parse = vi.fn(() => [...dom.window.document.querySelectorAll("article")].map(el => ({
    url: `https://www.facebook.com/groups/12345/posts/${el.getAttribute("data-id")}/`, text: el.textContent, images: [],
  })));
  const context = vm.createContext({ Date, Map, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    window: dom.window, document: dom.window.document, location: dom.window.location, MutationObserver: dom.window.MutationObserver,
    MyBotScrape: { postKey: url => url }, MyBotParser: { parseFacebookPosts: parse },
    chrome: { runtime: { sendMessage: (body, callback) => { messages.push({ at: Date.now(), posts: body.posts }); callback(reply); } },
      storage: { onChanged: { addListener: fn => { storageChanged = fn; } } } },
  });
  vm.runInContext(source, context);
  cleanups.push(() => { dom.window.dispatchEvent(new dom.window.Event("pagehide")); dom.window.close(); });
  return { dom, add, parse, messages, storageChanged: (data: object) => storageChanged(data, "local"), reply: (value: object) => { reply = value; } };
}

it("captures a DOM-added post without scrolling, within a coalesced half-second wake", async () => {
  const h = harness(); await vi.advanceTimersByTimeAsync(1100);
  const at = Date.now(); h.add(2);
  await vi.advanceTimersByTimeAsync(600);
  expect(h.messages).toHaveLength(2);
  expect(h.messages[1].posts.map(post => post.url)).toEqual(["https://www.facebook.com/groups/12345/posts/2/"]);
  expect(h.messages[1].at - at).toBeLessThanOrEqual(600);
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
