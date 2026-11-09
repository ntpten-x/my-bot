import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";

const source = readFileSync("extension/background.js", "utf8");
it("allows status and cleanup only from the extension popup", async () => {
  const cleanupBotTabs = vi.fn(async () => ({ closing: 0 }));
  const botTabStatus = vi.fn(async () => ({ closing: 1 }));
  const context = vm.createContext({ cleanupBotTabs, botTabStatus,
    chrome: { runtime: { getURL: file => `chrome-extension://synthetic/${file}` } } });
  vm.runInContext(source.slice(source.indexOf("async function handleTabLifecycleMessage("), source.indexOf("chrome.runtime.onMessage.addListener", source.indexOf("async function handleTabLifecycleMessage("))), context);
  const handle = context.handleTabLifecycleMessage;
  expect(await handle({ type: "bot-tabs-cleanup" }, { url: "https://www.facebook.com/" })).toBeNull();
  expect(await handle({ type: "bot-tabs-cleanup" }, { url: "https://owner.example/popup.html" })).toBeNull();
  expect(cleanupBotTabs).not.toHaveBeenCalled();
  const sender = { url: "chrome-extension://synthetic/popup.html" };
  expect(await handle({ type: "bot-tabs-status" }, sender)).toEqual({ ok: true, tabs: { closing: 1 } });
  expect(await handle({ type: "bot-tabs-cleanup" }, sender)).toEqual({ ok: true, tabs: { closing: 0 } });
});
it("shows why tabs are kept and routes the cleanup button to the worker without starting work", () => {
  const dom = new JSDOM(readFileSync("extension/popup.html", "utf8"));
  const tabs = { activeReaders: 1, activeComments: 0, parkedReaders: 2, closing: 1, idleReaders: 0, released: 3 };
  const sendMessage = vi.fn((_message, callback) => callback({ ok: true, tabs }));
  const context = vm.createContext({ document: dom.window.document,
    chrome: { runtime: { sendMessage }, storage: { onChanged: { addListener: () => {} } } } });
  const popup = readFileSync("extension/popup.js", "utf8");
  vm.runInContext(popup.slice(popup.indexOf("function showTabStatus(")), context);
  expect(dom.window.document.getElementById("tabStatus")?.textContent).toContain("รออ่านต่อ 2 · รอปิด 1");
  dom.window.document.getElementById("cleanupBotTabs")?.click();
  expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual(["bot-tabs-status", "bot-tabs-cleanup"]);
  expect(dom.window.document.getElementById("tabStatus")?.textContent).toContain("ระบบจะลองใหม่");
  dom.window.close();
});
