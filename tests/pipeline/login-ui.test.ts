// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("login page shows MY-BOT hero, theme control, and core form copy", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/auth/status")) {
      return Response.json({ authenticated: false, needsSetup: false });
    }
    return Response.json({});
  }));

  const { default: LoginPage } = await import("../../src/app/login/page");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(LoginPage));
    });
    // allow status effect
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("MY-BOT");
    expect(container.textContent).toContain("เรดาร์ลีดส่วนตัวของเครื่องนี้");
    expect(container.textContent).toContain("ชื่อผู้ใช้");
    expect(container.textContent).toContain("รหัสผ่าน");
    expect(container.textContent).toContain("รหัส Authenticator (ถ้ามี)");
    expect(container.textContent).toContain("เว้นว่างได้ถ้ายังไม่เปิด MFA");
    expect(container.textContent).toMatch(/เข้าสู่ระบบ/);
    expect(container.textContent).toContain("ลืมรหัสผ่าน");
    expect(container.querySelector('button[aria-label*="โหมด"], button[title*="โหมด"]')).toBeTruthy();
    expect(container.querySelector('a[href="/reset-password"]')).toBeTruthy();
    expect(container.querySelector("#username")).toBeTruthy();
    expect(container.querySelector("#password")).toBeTruthy();
    expect(container.querySelector("#otp")).toBeTruthy();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
