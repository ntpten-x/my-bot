# Login Soft Layer Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** อัปเกรด `/login` เป็น Soft Layer Gate — พื้นหลังชั้นเบา CSS, โชว์/ซ่อนรหัสผ่าน, MFA ยุบเป็นตัวเลือก — โดยไม่เปลี่ยน auth และไม่เพิ่มคอขวด

**Architecture:** แก้ `src/app/login/page.tsx` เป็นหลัก · soft layer เป็น `div` ตกแต่ง `pointer-events-none` · ปุ่มโชว์รหัสอยู่ใน wrapper ของช่อง password · MFA ใช้ state `showMfa` · อัปเดต `tests/pipeline/login-ui.test.ts` ให้สะท้อน UX ใหม่

**Tech Stack:** Next.js App Router, React 19, Tailwind theme tokens (`accent-soft` มีอยู่แล้ว), Vitest + jsdom

**Spec:** `docs/superpowers/specs/2026-11-21-login-soft-layer-gate-design.md`

## Global Constraints

- ห้ามเปลี่ยน API `/api/auth/login` หรือ `/api/auth/status` หรือ redirect กฎเดิม
- ส่ง `{ username, password, code }` โดย `code` เป็น `""` เมื่อ MFA ปิดหรือว่าง
- ใช้โทเคนธีมที่มีอยู่เท่านั้น (`bg`, `fg`, `muted`, `card`, `line`, `accent`, `on-accent`, `accent-soft`, `danger`)
- ไม่โหลดฟอนต์/dependency/รูป/Lottie/canvas ใหม่ · ไม่ใช้ `backdrop-filter` · ไม่มี animation วน
- ไม่รีดีไซน์ `/setup` หรือ `/reset-password`
- Commit เฉพาะเมื่อเจ้าของสั่ง; ก่อน commit รัน `npm test` และ `npm run build`
- หลัง deploy ในเครื่อง: ต้อง `npm run build` แล้วรีสตาร์ท `start:prod` ไม่งั้น UI เก่าค้าง

## File map

| File | Role |
| --- | --- |
| `src/app/login/page.tsx` | Soft Layer Gate UI + UX |
| `tests/pipeline/login-ui.test.ts` | โครงสร้าง/copy/โชว์รหัส/MFA ยุบ |
| `docs/superpowers/specs/2026-11-21-login-soft-layer-gate-design.md` | สเปก |

---

### Task 1: Update failing UI tests for Soft Layer Gate

**Files:**
- Modify: `tests/pipeline/login-ui.test.ts`

**Interfaces:**
- Consumes: `LoginPage` default export from `src/app/login/page.tsx`
- Expects decorative node: `[data-login-atmosphere]`
- Expects password toggle: `button[aria-label="แสดงรหัสผ่าน"]` (initial)
- Expects MFA closed by default: no `#otp` until expand; control text `มีรหัส Authenticator`

- [ ] **Step 1: Replace the test file** with:

```ts
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

async function renderLogin() {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  await act(async () => {
    root.render(React.createElement(LoginPage));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { container, root };
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
```

Note: move `vi.mock("next/navigation")` to top level to avoid Vitest 4 hoist warnings.

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/pipeline/login-ui.test.ts`

Expected: FAIL (MFA still always visible / no atmosphere / no show-password)

- [ ] **Step 3: Commit** (only if owner asks)

---

### Task 2: Implement Soft Layer Gate login page

**Files:**
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Keep existing `submit` / status `useEffect` behavior
- Add `showPassword: boolean` (default `false`) and `showMfa: boolean` (default `false`)
- Login body still sends `code` from state (empty string when MFA never opened or cleared)

- [ ] **Step 1: Replace page implementation** (preserve auth logic; structure below)

```tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ApiError, api } from "@/components/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showMfa, setShowMfa] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((response) => response.json())
      .then((data) => {
        if (data.authenticated) router.replace("/dashboard");
        else if (data.needsSetup) router.replace("/setup");
        else setReady(true);
      })
      .catch(() => setReady(true));
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ weakPassword?: boolean; mfaSetupRequired?: boolean }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password, code }),
      });
      router.replace(result.weakPassword || result.mfaSetupRequired ? "/settings/security" : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg text-fg">
      <div
        data-login-atmosphere
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 55% at 50% -10%, color-mix(in oklab, var(--color-accent) 22%, transparent), transparent 70%), radial-gradient(ellipse 50% 40% at 100% 100%, color-mix(in oklab, var(--color-accent-soft) 80%, transparent), transparent 65%)",
        }}
      />
      <div className="absolute right-4 top-4 z-10 md:right-6 md:top-6">
        <ThemeToggle />
      </div>
      <main className="relative z-[1] mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-fg md:text-5xl">MY-BOT</h1>
          <p className="mt-3 text-sm text-muted">เรดาร์ลีดส่วนตัวของเครื่องนี้</p>
        </div>
        <Card className="mt-8 border border-line bg-card/95 p-5 shadow-none md:p-6">
          {ready ? (
            <form onSubmit={submit} className="space-y-5">
              <div>
                <Label htmlFor="username">ชื่อผู้ใช้</Label>
                <Input
                  id="username"
                  className="h-11"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[A-Za-z0-9_.-]+"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoFocus
                />
                <p className="mt-1 text-xs text-muted">บัญชีเดิมใช้ชื่อ admin</p>
              </div>
              <div>
                <Label htmlFor="password">รหัสผ่าน</Label>
                <div className="relative">
                  <Input
                    id="password"
                    className="h-11 pr-24"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    maxLength={200}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? "ซ่อน" : "แสดง"}
                  </button>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  className="text-sm text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  aria-expanded={showMfa}
                  onClick={() => setShowMfa((value) => !value)}
                >
                  {showMfa ? "ซ่อนรหัส Authenticator" : "มีรหัส Authenticator"}
                </button>
                {showMfa ? (
                  <div className="mt-3">
                    <Label htmlFor="otp">รหัส Authenticator</Label>
                    <Input
                      id="otp"
                      className="h-11"
                      autoComplete="one-time-code"
                      maxLength={64}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted">เว้นว่างได้ถ้ายังไม่เปิด MFA</p>
                  </div>
                ) : null}
              </div>
              {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" disabled={busy} className="h-11 w-full">
                {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
              </Button>
              <p className="text-center text-sm">
                <Link href="/reset-password" className="text-accent underline-offset-2 hover:underline">
                  ลืมรหัสผ่าน
                </Link>
              </p>
            </form>
          ) : (
            <p className="text-sm text-muted">กำลังเตรียมหน้าเข้าสู่ระบบ…</p>
          )}
        </Card>
      </main>
    </div>
  );
}
```

If `color-mix` / `oklab` looks wrong in a target browser during manual check, fall back to Tailwind-only layers using `bg-accent/10` and `bg-accent-soft` absolute blurs **without** `backdrop-filter` (still CSS-only, no JS).

- [ ] **Step 2: Run UI tests — expect PASS**

Run: `npx vitest run tests/pipeline/login-ui.test.ts`

- [ ] **Step 3: Auth smoke**

Run: `npx vitest run tests/pipeline/passport-auth-db.test.ts tests/pipeline/private-layout-security.test.ts`

Expected: PASS or skip-without-TEST_DATABASE_URL (must not newly fail)

- [ ] **Step 4: Commit** (only if owner asks)

---

### Task 3: Full verification + serve new build

- [ ] **Step 1:** `npm test`
- [ ] **Step 2:** `npm run build`
- [ ] **Step 3:** Restart production on `:8001` (`stop` old `start:prod`, then `npm run start:prod`) so `/login` serves the new markup
- [ ] **Step 4:** Manual: dark+light, แสดง/ซ่อนรหัส, เปิด MFA, soft layer ปรากฏ, ล็อกอินผิดเห็น alert
- [ ] **Step 5:** Report; commit/push only when owner asks

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| Soft layer CSS atmosphere | 2 |
| MY-BOT hero + support line | 2 |
| ThemeToggle | 2 |
| Show/hide password | 1–2 |
| Collapsed MFA + copy | 1–2 |
| Auth unchanged | 2–3 |
| No heavy assets/animation | 2 |
| test + build + restart serve | 3 |

## Self-review

- No TBD
- Commits gated on owner
- `vi.mock` top-level to clear Vitest warning
- Password toggle is page-local (does not change shared `Input` for whole app)
