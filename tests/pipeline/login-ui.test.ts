// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function renderLogin(
  onLogin?: (init?: RequestInit) => Response | Promise<Response>,
) {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/auth/status")) {
      return Response.json({ authenticated: false, needsSetup: false });
    }
    if (String(url).includes("/api/auth/login") && onLogin) {
      return onLogin(init);
    }
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);

  const { default: LoginPage } = await import("../../src/app/login/page");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(LoginPage));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { container, root, fetchMock };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("login page shows Soft Layer Gate structure and collapsed MFA", async () => {
  const { container, root } = await renderLogin();
  try {
    expect(container.textContent).toContain("MY-BOT");
    expect(container.textContent).toContain("เรดาร์ลีดส่วนตัวของเครื่องนี้");
    expect(container.textContent).toContain("ชื่อผู้ใช้");
    expect(container.textContent).toContain("รหัสผ่าน");
    expect(container.textContent).toContain("มีรหัส Authenticator");
    expect(container.textContent).not.toContain("เว้นว่างได้ถ้ายังไม่เปิด MFA");
    expect(container.textContent).toMatch(/เข้าสู่ระบบ/);
    expect(container.textContent).toContain("ลืมรหัสผ่าน");
    expect(container.querySelector("[data-login-atmosphere]")).toBeTruthy();
    expect(container.querySelector('button[aria-label*="โหมด"], button[title*="โหมด"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="แสดงรหัสผ่าน"]')).toBeTruthy();
    expect(container.querySelector('a[href="/reset-password"]')).toBeTruthy();
    expect(container.querySelector("#username")).toBeTruthy();
    expect(container.querySelector("#password")).toBeTruthy();
    expect(container.querySelector("#otp")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("login page reveals MFA field and toggles password visibility", async () => {
  const { container, root } = await renderLogin();
  try {
    const mfaToggle = Array.from(container.querySelectorAll("button")).find((el) =>
      el.textContent?.includes("มีรหัส Authenticator"),
    );
    expect(mfaToggle).toBeTruthy();
    await act(async () => {
      mfaToggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("#otp")).toBeTruthy();
    expect(container.textContent).toContain("เว้นว่างได้ถ้ายังไม่เปิด MFA");

    const show = container.querySelector('button[aria-label="แสดงรหัสผ่าน"]') as HTMLButtonElement;
    expect(show).toBeTruthy();
    expect((container.querySelector("#password") as HTMLInputElement).type).toBe("password");
    await act(async () => {
      show.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((container.querySelector("#password") as HTMLInputElement).type).toBe("text");
    expect(container.querySelector('button[aria-label="ซ่อนรหัสผ่าน"]')).toBeTruthy();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("collapsing MFA clears OTP state and submits empty code", async () => {
  const { container, root, fetchMock } = await renderLogin(() => Response.json({ ok: true }));
  try {
    const findMfaToggle = () =>
      Array.from(container.querySelectorAll("button")).find((el) =>
        el.textContent?.includes("Authenticator"),
      )!;

    await act(async () => {
      findMfaToggle().click();
    });
    const otp = container.querySelector("#otp") as HTMLInputElement;
    expect(otp).toBeTruthy();

    await act(async () => {
      setInputValue(otp, "123456");
    });
    expect(otp.value).toBe("123456");

    await act(async () => {
      findMfaToggle().click();
    });
    expect(container.querySelector("#otp")).toBeNull();

    await act(async () => {
      findMfaToggle().click();
    });
    expect((container.querySelector("#otp") as HTMLInputElement).value).toBe("");

    await act(async () => {
      setInputValue(container.querySelector("#otp") as HTMLInputElement, "654321");
    });
    await act(async () => {
      findMfaToggle().click();
    });

    const password = container.querySelector("#password") as HTMLInputElement;
    await act(async () => {
      setInputValue(password, "secret-pass");
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const loginCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/auth/login"));
    expect(loginCall).toBeTruthy();
    expect(JSON.parse(String(loginCall![1]?.body))).toEqual({
      username: "admin",
      password: "secret-pass",
      code: "",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("shows login error with role=alert when login API fails", async () => {
  const { container, root } = await renderLogin(() =>
    Response.json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 }),
  );
  try {
    const password = container.querySelector("#password") as HTMLInputElement;
    await act(async () => {
      setInputValue(password, "wrong-pass");
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toBe("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    expect(container.querySelector("#otp")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("auto-expands MFA field when login fails because MFA is required", async () => {
  const { container, root } = await renderLogin(() =>
    Response.json({ error: "กรอกรหัส Authenticator หรือ recovery code", mfaRequired: true }, { status: 401 }),
  );
  try {
    expect(container.querySelector("#otp")).toBeNull();
    const password = container.querySelector("#password") as HTMLInputElement;
    await act(async () => {
      setInputValue(password, "correct-pass");
    });

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("กรอกรหัส Authenticator หรือ recovery code");
    expect(container.querySelector("#otp")).toBeTruthy();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
