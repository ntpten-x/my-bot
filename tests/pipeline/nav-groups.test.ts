// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NavGroups } from "../../src/components/layout/nav-groups";
import { NAV_GROUPS } from "../../src/components/layout/nav-config";
import {
  NAV_GROUPS_STORAGE_KEY,
  groupIdForPath,
  isNavItemActive,
  readGroupOpenState,
  resolveGroupOpen,
  writeGroupOpenState,
} from "../../src/components/layout/nav-groups-state";

afterEach(() => {
  window.localStorage.removeItem(NAV_GROUPS_STORAGE_KEY);
});

it("NAV_GROUPS lists every previous shell href exactly once", () => {
  const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)).sort();
  expect(hrefs).toEqual([
    "/accounts",
    "/auto-comment",
    "/automation",
    "/categories",
    "/dashboard",
    "/feed",
    "/getting-started",
    "/groups",
    "/guide",
    "/learn",
    "/messages",
    "/notifications",
    "/overview",
    "/parser",
    "/pipeline",
    "/settings",
    "/sources",
    "/summaries",
    "/templates",
  ].sort());
});

it("isNavItemActive matches exact path and settings prefix", () => {
  expect(isNavItemActive("/feed", "/feed")).toBe(true);
  expect(isNavItemActive("/feed/x", "/feed")).toBe(false);
  expect(isNavItemActive("/settings", "/settings")).toBe(true);
  expect(isNavItemActive("/settings/security", "/settings")).toBe(true);
  expect(isNavItemActive("/guide", "/settings")).toBe(false);
});

it("groupIdForPath finds the group containing the route", () => {
  expect(groupIdForPath("/feed")).toBe("leads");
  expect(groupIdForPath("/settings/desktop")).toBe("system");
  expect(groupIdForPath("/nope")).toBe(null);
});

it("resolveGroupOpen forces open for the active group", () => {
  const stored = readGroupOpenState(window.localStorage);
  stored.leads = false;
  expect(resolveGroupOpen("leads", "/feed", stored)).toBe(true);
  expect(resolveGroupOpen("system", "/feed", stored)).toBe(stored.system);
});

it("read/writeGroupOpenState round-trips", () => {
  const next = { ...readGroupOpenState(window.localStorage), automation: true };
  writeGroupOpenState(next, window.localStorage);
  expect(JSON.parse(window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY)!).automation).toBe(true);
});

it("NavGroups expands the active group and toggles another group", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify({
    start: false, leads: false, messages: false, automation: false, sources: false, system: false,
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(NavGroups, { pathname: "/feed", unread: 2 }));
    });
    expect(container.textContent).toContain("ฟีดลีด");
    expect(container.textContent).not.toContain("ตั้งค่า");
    const notifications = [...container.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/notifications");
    const unread = [...(notifications?.querySelectorAll("span") ?? [])].find((node) => node.textContent === "2");
    expect(unread?.textContent).toBe("2");
    const systemButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("ระบบ"));
    expect(systemButton).toBeTruthy();
    expect(systemButton!.disabled).toBe(false);
    await act(async () => { systemButton!.click(); });
    expect(container.textContent).toContain("ตั้งค่า");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("does not toggle the active route group or hide its links", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify({
    start: false, leads: true, messages: false, automation: false, sources: false, system: false,
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(NavGroups, { pathname: "/feed", unread: 0 }));
    });
    const feed = [...container.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/feed");
    expect(feed?.textContent).toContain("ฟีดลีด");
    const leadsButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("ลีด"));
    expect(leadsButton).toBeTruthy();
    expect(leadsButton!.disabled).toBe(true);
    expect(leadsButton!.getAttribute("aria-disabled")).toBe("true");
    await act(async () => { leadsButton!.click(); });
    const stored = JSON.parse(window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY)!) as { leads: boolean };
    expect(stored.leads).toBe(true);
    expect([...container.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/feed")).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
