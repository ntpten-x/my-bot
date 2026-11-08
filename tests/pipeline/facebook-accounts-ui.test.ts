// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "../../src/app/(app)/accounts/page";
let root: Root; let container: HTMLDivElement; let enabled: boolean;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); enabled = true;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") { enabled = JSON.parse(String(init.body)).enabled; return new Response('{"ok":true}'); }
    return new Response(JSON.stringify({ checkedAt: new Date().toISOString(), accounts: [{ id: "12345", name: "บัญชีทดสอบ", enabled, connected: true, localEnabled: true, status: enabled ? "ready" : "paused", postsCaptured: 12, lastSeenAt: new Date().toISOString(), devices: [] }] }));
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("shows connection separately from the account's work switch and resumes without login changes", async () => {
  await act(async () => root.render(React.createElement(Page)));
  expect(container.textContent).toContain("ออนไลน์ · เชื่อมต่ออยู่"); expect(container.textContent).toContain("พร้อมรับงาน");
  const stop = container.querySelector<HTMLButtonElement>('[aria-label="หยุดทำงาน บัญชีทดสอบ"]')!;
  await act(async () => stop.click());
  expect(fetch).toHaveBeenCalledWith("/api/facebook-accounts/12345", expect.objectContaining({ method: "PATCH", body: '{"enabled":false}' }));
  expect(container.textContent).toContain("ออนไลน์ · เชื่อมต่ออยู่"); expect(container.textContent).toContain("หยุดงานจากระบบ");
  const resume = container.querySelector<HTMLButtonElement>('[aria-label="เปิดทำงาน บัญชีทดสอบ"]')!;
  await act(async () => resume.click()); expect(container.textContent).toContain("พร้อมรับงาน");
  expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith("/api/facebook-accounts"))).toBe(true);
});
it("shows instructions for an installation with no observed accounts", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{"accounts":[],"checkedAt":"2026-11-08T00:00:00Z"}'));
  await act(async () => root.render(React.createElement(Page)));
  expect(container.textContent).toContain("ยังไม่มีบัญชี Facebook เชื่อมต่อ");
  expect(container.querySelector('a[href="/settings/extension"]')).not.toBeNull();
});
