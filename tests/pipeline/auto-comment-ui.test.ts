// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "../../src/app/(app)/auto-comment/page";
import { CommentReadinessPanel } from "../../src/components/comment-readiness";
const dashboard = { control: { state: "stopped", dryRun: true, emergency: false, hourlyLimit: 5, dailyLimit: 20, cooldownUntil: null }, rules: [], sources: [], jobs: [], logs: [], counts: {}, observed: 0, matched: 0 };
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url === "/api/automation-readiness" ? { extensions: [], accounts: [] } : dashboard), { status: 200 })));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("renders browser delivery with safe defaults and no Facebook credential fields", async () => {
  await act(async () => { root.render(React.createElement(Page)); });
  expect(container.textContent).toContain("Dry Run — ไม่ส่งจริง"); expect(container.textContent).toContain("หยุดอยู่");
  expect(container.querySelector("#page-token")).toBeNull(); expect(container.querySelector("#manager-token")).toBeNull();
  expect(container.querySelector("#browser-device")).not.toBeNull(); expect(container.querySelector("#browser-account")).not.toBeNull();
  expect(container.textContent).toContain("Extension"); expect(container.textContent).toContain("3 วินาที");
  const start = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.includes("Start"))!;
  await act(async () => start.click());
  expect(fetch).toHaveBeenCalledWith("/api/auto-comment", expect.objectContaining({ method: "PUT", body: '{"action":"start"}' }));
});
it("keeps Emergency Stop actionable and requests only the emergency command", async () => {
  await act(async () => root.render(React.createElement(Page)));
  const emergency = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.includes("Emergency Stop"))!;
  expect(emergency.disabled).toBe(false); await act(async () => emergency.click());
  expect(fetch).toHaveBeenCalledWith("/api/auto-comment", expect.objectContaining({ method: "PUT", body: '{"action":"emergency"}' }));
});

it("prepares a keyword bot preset without AI or submitting it", async () => {
  await act(async () => root.render(React.createElement(Page)));
  const preset = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.includes("ใช้ตัวอย่าง"))!;
  await act(async () => preset.click());
  expect(container.querySelector("#intent-mode")).toBeNull();
  expect(container.querySelector<HTMLTextAreaElement>("#required-words")!.value).toContain("รองเท้า");
  expect(container.querySelector<HTMLTextAreaElement>("#comment-templates")!.value).toBe("");
  expect(container.textContent).toContain("กฎยังปิดอยู่");
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init || !["POST", "PUT"].includes(init.method ?? ""))).toBe(true);
});

async function fill(selector: string, value: string) {
  const node = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("saves separate messages as an extension keyword rule with no AI dependency", async () => {
  await act(async () => root.render(React.createElement(Page)));
  await fill("#rule-name", "กฎทดสอบ");
  await fill("#required-words", "รองเท้า");
  await fill("#comment-templates", "ข้อความแรก\n---\nยังเป็นข้อความเดียว");
  const add = Array.from(container.querySelectorAll("button")).find(node => node.textContent?.includes("เพิ่มข้อความ"))!;
  await act(async () => add.click());
  await fill("#comment-template-1", "ข้อความที่สอง");
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(String(call[1]!.body))).toMatchObject({
    intentMode: "keyword", requireAi: false, messageMode: "template", deliveryMode: "extension", enabled: false,
    templates: ["ข้อความแรก\n---\nยังเป็นข้อความเดียว", "ข้อความที่สอง"],
  });
});

it("rejects empty keyword lists before creating a rule", async () => {
  await act(async () => root.render(React.createElement(Page)));
  await fill("#required-words", " , \n , ");
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="alert"]')!.textContent).toContain("ระบุคำสำคัญอย่างน้อยหนึ่งคำ");
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("shows dry-run and the bound device opt-in as blockers even when a different device is ready", async () => {
  const rule = { id: "rule", name: "กฎทดสอบ", enabled: true, browserDeviceId: "bound", browserFbUserId: "123456", browserConsent: true, pausedReason: "", deliveryMode: "extension", requireAi: false, messageMode: "template" };
  const readiness = { extensions: [
    { id: "bound", name: "เครื่องที่ผูก", online: true, fbUserId: "123456", commentsEnabled: false },
    { id: "other", name: "เครื่องอื่น", online: true, fbUserId: "123456", commentsEnabled: true },
  ], accounts: [], steps: [{ key: "worker", ready: true }, { key: "ai", ready: false }] };
  await act(async () => root.render(React.createElement(CommentReadinessPanel, { control: dashboard.control, rules: [rule], readiness })));
  expect(container.textContent).toContain("ยังไม่ส่งจริง: Dry Run เปิดอยู่");
  expect(container.textContent).toContain("Extension ปิดรับงานคอมเมนต์");
  expect(container.textContent).toContain("กฎนี้ไม่รอ AI แม้ผู้ให้บริการ AI ไม่พร้อม");
  readiness.extensions[0].commentsEnabled = true;
  await act(async () => root.render(React.createElement(CommentReadinessPanel, { control: dashboard.control, rules: [rule], readiness })));
  expect(container.textContent).toContain("อุปกรณ์และบัญชีพร้อมรับงาน");
});
