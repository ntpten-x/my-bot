// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "../../src/app/(app)/auto-comment/page";
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
