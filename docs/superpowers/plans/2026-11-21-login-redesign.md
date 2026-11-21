# Login Redesign (Radar Quiet Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** รีดีไซน์ `/login` ให้ MY-BOT เป็นฮีโร่กลางจอ การ์ดฟอร์มเรียบ มี ThemeToggle และ copy ตามสเปก โดยไม่เปลี่ยน auth logic

**Architecture:** แก้ `src/app/login/page.tsx` เป็นหลัก · ใช้ `Button`/`Input`/`Label`/`Card` จาก UI เดิม + `ThemeToggle` จาก layout · เพิ่มเทส jsdom ตรวจโครงสร้างและข้อความสำคัญ

**Tech Stack:** Next.js App Router, React 19, Tailwind theme tokens, Vitest + jsdom

**Spec:** `docs/superpowers/specs/2026-11-21-login-redesign-design.md`

## Global Constraints

- ห้ามเปลี่ยน API `/api/auth/login` หรือ `/api/auth/status` หรือ redirect กฎเดิม
- MFA field แสดงตลอด; เว้นว่างได้
- ใช้โทเคนธีมที่มีอยู่ (`bg`, `fg`, `muted`, `card`, `line`, `accent`, `on-accent`, `danger`)
- ไม่รีดีไซน์ `/setup` หรือ `/reset-password` ในรอบนี้
- Commit เฉพาะเมื่อเจ้าของสั่ง; ก่อน commit รัน `npm test` และ `npm run build`

## File map

| File | Role |
| --- | --- |
| `src/app/login/page.tsx` | หน้า login ใหม่ |
| `tests/pipeline/login-ui.test.ts` | เทสโครงสร้าง/copy/ปุ่ม |
| `docs/superpowers/specs/2026-11-21-login-redesign-design.md` | สเปก (commit พร้อมงานถ้ายังไม่ขึ้น git) |

---

### Task 1: Failing UI test for Radar Quiet Gate structure

**Files:**
- Create: `tests/pipeline/login-ui.test.ts`

**Interfaces:**
- Consumes: `LoginPage` default export from `src/app/login/page.tsx`
- Mock `next/navigation` router and `fetch`/`api` as needed so the form renders in `ready` state

- [ ] **Step 1: Write the failing test**

```ts
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
```

If `vi.mock` hoist issues with dynamic import, follow the repo pattern from other jsdom tests (stub fetch + import page after mocks). Adjust ThemeToggle selector to match existing `aria-label` strings: `สลับเป็นโหมดสว่าง` / `สลับเป็นโหมดมืด`.

- [ ] **Step 2: Run — expect FAIL or missing copy**

Run: `npx vitest run tests/pipeline/login-ui.test.ts`

Expected: FAIL (old copy / no theme toggle / wrong MFA label)

- [ ] **Step 3: Commit** (only if owner asks) — usually wait until implementation passes

---

### Task 2: Implement login page markup

**Files:**
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Keep all existing state + `submit` + status `useEffect` logic byte-compatible in behavior
- Import `ThemeToggle` from `@/components/layout/theme-toggle` (or `@/components/theme-toggle` shim)

- [ ] **Step 1: Replace the return JSX** (keep hooks/handlers above)

Structure:

```tsx
return (
  <div className="relative min-h-screen bg-bg text-fg">
    <div className="absolute right-4 top-4 z-10 md:right-6 md:top-6">
      <ThemeToggle />
    </div>
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-fg md:text-5xl">MY-BOT</h1>
        <p className="mt-3 text-sm text-muted">เรดาร์ลีดส่วนตัวของเครื่องนี้</p>
      </div>
      <Card className="mt-8 border border-line bg-card p-5 shadow-none md:p-6">
        {ready ? (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="username">ชื่อผู้ใช้</Label>
              <Input id="username" ... unchanged props ... />
              <p className="mt-1 text-xs text-muted">บัญชีเดิมใช้ชื่อ admin</p>
            </div>
            <div>
              <Label htmlFor="password">รหัสผ่าน</Label>
              <Input id="password" type="password" ... />
            </div>
            <div>
              <Label htmlFor="otp">รหัส Authenticator (ถ้ามี)</Label>
              <Input id="otp" ... />
              <p className="mt-1 text-xs text-muted">เว้นว่างได้ถ้ายังไม่เปิด MFA</p>
            </div>
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
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
```

Preserve `autoFocus` on username, validation attributes, and submit handler exactly.

- [ ] **Step 2: Run UI test — expect PASS**

Run: `npx vitest run tests/pipeline/login-ui.test.ts`

- [ ] **Step 3: Run auth regression smoke**

Run: `npx vitest run tests/pipeline/passport-auth-db.test.ts tests/pipeline/private-layout-security.test.ts`

Expected: PASS or skip-without-TEST_DATABASE_URL as before (must not newly fail)

- [ ] **Step 4: Commit** (only if owner asks)

---

### Task 3: Full verification

- [ ] **Step 1:** `npm test`
- [ ] **Step 2:** `npm run build`
- [ ] **Step 3:** Manual: open `/login` dark+light, toggle theme, submit wrong password sees alert, link to reset works
- [ ] **Step 4:** Report; commit/push only when owner asks

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| MY-BOT hero + one support line | 2 |
| ThemeToggle top-right | 2 |
| MFA always visible + hint | 2 |
| Copy table | 1–2 |
| Auth behavior unchanged | 2–3 |
| test + build | 3 |

## Self-review

- No TBD
- Does not redesign setup/reset
- Commits gated on owner request
