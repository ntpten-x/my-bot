import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function harness() {
  let now = 100_000;
  class Clock extends Date { static now() { return now; } }
  const alarms = new Map<string, { when: number }>();
  const drain = vi.fn(async () => undefined);
  let fire: (alarm: { name: string }) => void;
  const context = vm.createContext({ Date: Clock, DUE_ALARM: "mybot-due", commentWorkerDeps: () => ({}),
    MyBotCommentWorker: { drain }, chrome: { alarms: {
    onAlarm: { addListener: (listener: typeof fire) => { fire = listener; } },
    get: async (name: string) => alarms.has(name) ? { scheduledTime: alarms.get(name)!.when } : undefined,
    create: async (name: string, options: { when: number }) => { alarms.set(name, options); },
  } } });
  const source = readFileSync("extension/background.js", "utf8");
  vm.runInContext(source.slice(source.indexOf("/** Chrome period alarms"), source.indexOf("// Serialize chrome.storage")), context);
  vm.runInContext(source.slice(source.indexOf("chrome.alarms.onAlarm.addListener"), source.indexOf("// A fresh service worker")), context);
  return { alarms, drain, fire: (name: string) => fire({ name }), wake: () => vm.runInContext("nudgeCommentDrain()", context) as Promise<void>, advance: (ms: number) => { now += ms; } };
}

it("keeps a follow-up wake after the worker's three-second scan cadence", async () => {
  const h = harness(); await h.wake();
  expect([...h.alarms.values()].some(alarm => alarm.when >= 105_000 && alarm.when < 130_000)).toBe(true);
});

it("routes every bounded follow-up alarm to the sequential comment drain", async () => {
  const h = harness(); await h.wake();
  for (const name of h.alarms.keys()) h.fire(name);
  expect(h.drain).toHaveBeenCalledTimes(h.alarms.size);
});

it("does not postpone pending wakes when captures arrive continuously", async () => {
  const h = harness(); await h.wake();
  const first = h.alarms.get("mybot-comment-nudge")!.when;
  for (let i = 0; i < 10; i++) { h.advance(100); await h.wake(); }
  expect(h.alarms.get("mybot-comment-nudge")!.when).toBe(first);
});
