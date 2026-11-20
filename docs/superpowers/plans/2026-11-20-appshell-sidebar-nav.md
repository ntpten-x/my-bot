# AppShell + Radar Console Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แยก AppShell เป็น Header/Sidebar/Main/Footer และทำเมนูจัดกลุ่มพับได้แบบ Radar Console พร้อม drawer มือถือ โดยไม่เปลี่ยน URL หรือพฤติกรรมธุรกิจ

**Architecture:** `nav-config` เป็นแหล่งเมนูเดียว · `NavGroups` ใช้ร่วม Sidebar และ MobileNav · สถานะพับกลุ่มใน `localStorage` (`mybot.nav.groups`) · `Shell` เดิมเป็น shim re-export · ธีม/ unread/logout คงพฤติกรรมเดิม

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4 tokens, Lucide, Vitest + jsdom

**Specs:**
- `docs/superpowers/specs/2026-11-20-app-structure-design.md` (เฟส 1 Layout)
- `docs/superpowers/specs/2026-11-20-sidebar-nav-ux-design.md`

## Global Constraints

- URL หน้าและ `/api/*` ไม่เปลี่ยน
- ไม่ตัดหน้าออกจากเมนู — ครบตามตารางกลุ่มในสเปก sidebar
- ไม่รีดีไซน์ธีมสีกลาง (ใช้ accent / sidebar / accent-soft / on-accent ที่มี)
- ไม่แตะ extension/, Desktop package, Prisma, `lib/ai|pipeline|auto-comment|smart` ทั้งก้อน
- Path เก่า `components/shell.tsx` และ `components/theme-toggle.tsx` ต้องยัง import ได้ผ่าน shim
- ก่อน commit: `npm test` และ `npm run build` ผ่าน (AGENTS.md)
- Commit เฉพาะเมื่อเจ้าของสั่ง
- เฟสย้าย `components/ui`, `features/*`, `services/*` **นอกแผนนี้** (แผน follow-up จาก app-structure เฟส 2–6)

## File map

| File | Responsibility |
| --- | --- |
| `src/components/layout/nav-config.ts` | กลุ่มเมนู + รายการ + ไอคอน |
| `src/components/layout/nav-groups-state.ts` | อ่าน/เขียน localStorage พับกลุ่ม + resolve กลุ่มที่ต้องเปิด |
| `src/components/layout/nav-groups.tsx` | UI หัวกลุ่มพับได้ + ลิงก์ |
| `src/components/layout/sidebar.tsx` | เดสก์ท็อป chrome |
| `src/components/layout/header.tsx` | มือถือ top bar + ปุ่มเปิดเมนู |
| `src/components/layout/mobile-nav.tsx` | Drawer |
| `src/components/layout/main.tsx` | พื้นที่เนื้อหา |
| `src/components/layout/footer.tsx` | แถบเวอร์ชัน/ลิงก์วิธีใช้ |
| `src/components/layout/app-shell.tsx` | ประกอบทั้งหมด + unread/logout/activity |
| `src/components/layout/theme-toggle.tsx` | ย้ายจาก components/ |
| `src/components/shell.tsx` | shim → AppShell as Shell |
| `src/components/theme-toggle.tsx` | shim → layout ThemeToggle |
| `src/app/(app)/layout.tsx` | ใช้ AppShell (หรือ Shell shim ก็ได้) |
| `tests/pipeline/nav-groups.test.ts` | unit + UI กลุ่ม/พับ |
| `tests/pipeline/feed-lifecycle.test.ts` | ยัง mount Shell ได้ |

---

### Task 1: nav-config + group state (TDD)

**Files:**
- Create: `src/components/layout/nav-config.ts`
- Create: `src/components/layout/nav-groups-state.ts`
- Create: `tests/pipeline/nav-groups.test.ts`

**Interfaces:**
- Produces:
  - `export type NavGroupId = "start" | "leads" | "messages" | "automation" | "sources" | "system"`
  - `export type NavItem = { href: string; label: string; icon: LucideIcon }`
  - `export type NavGroup = { id: NavGroupId; label: string; items: NavItem[] }`
  - `export const NAV_GROUPS: NavGroup[]`
  - `export const NAV_GROUPS_STORAGE_KEY = "mybot.nav.groups"`
  - `export function isNavItemActive(pathname: string, href: string): boolean`
  - `export function groupIdForPath(pathname: string): NavGroupId | null`
  - `export function readGroupOpenState(storage?: Storage | null): Record<NavGroupId, boolean>`
  - `export function writeGroupOpenState(state: Record<NavGroupId, boolean>, storage?: Storage | null): void`
  - `export function resolveGroupOpen(groupId: NavGroupId, pathname: string, stored: Record<NavGroupId, boolean>): boolean`

- [ ] **Step 1: Write failing tests**

```ts
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  NAV_GROUPS,
  NAV_GROUPS_STORAGE_KEY,
  groupIdForPath,
  isNavItemActive,
  readGroupOpenState,
  resolveGroupOpen,
  writeGroupOpenState,
} from "../../src/components/layout/nav-groups-state";
import { NAV_GROUPS as GROUPS_FROM_CONFIG } from "../../src/components/layout/nav-config";

// Prefer importing NAV_GROUPS only from nav-config in implementation;
// tests may import config + state separately. Adjust imports so NAV_GROUPS
// lives in nav-config.ts and state helpers in nav-groups-state.ts.

afterEach(() => {
  window.localStorage.removeItem(NAV_GROUPS_STORAGE_KEY);
});

it("NAV_GROUPS lists every previous shell href exactly once", () => {
  const hrefs = GROUPS_FROM_CONFIG.flatMap((g) => g.items.map((i) => i.href)).sort();
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
```

Fix the test file imports after creating modules so `NAV_GROUPS` comes from `nav-config.ts` and helpers from `nav-groups-state.ts` (re-export `NAV_GROUPS_STORAGE_KEY` from state file).

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/pipeline/nav-groups.test.ts`

Expected: FAIL module not found

- [ ] **Step 3: Implement nav-config.ts**

Create `src/components/layout/nav-config.ts` with Lucide icons matching previous shell intent:

```ts
import type { LucideIcon } from "lucide-react";
import {
  Activity, Bell, BookOpen, Bookmark, Bug, LayoutDashboard, Lightbulb,
  MessageSquareText, Radar, Rss, Settings, Sun, Tags, Users, Workflow,
} from "lucide-react";

export type NavGroupId = "start" | "leads" | "messages" | "automation" | "sources" | "system";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavGroup = { id: NavGroupId; label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "start",
    label: "เริ่มต้น",
    items: [
      { href: "/getting-started", label: "เริ่มใช้งาน", icon: Activity },
      { href: "/overview", label: "ภาพรวมระบบ", icon: Activity },
      { href: "/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard },
    ],
  },
  {
    id: "leads",
    label: "ลีด",
    items: [
      { href: "/feed", label: "ฟีดลีด", icon: Radar },
      { href: "/pipeline", label: "ไปป์ไลน์", icon: Bookmark },
      { href: "/summaries", label: "สรุปรายวัน", icon: Sun },
      { href: "/notifications", label: "การแจ้งเตือน", icon: Bell },
    ],
  },
  {
    id: "messages",
    label: "ข้อความ",
    items: [
      { href: "/messages", label: "จัดการข้อความ", icon: MessageSquareText },
      { href: "/templates", label: "ข้อความสำเร็จรูป", icon: MessageSquareText },
    ],
  },
  {
    id: "automation",
    label: "อัตโนมัติ",
    items: [
      { href: "/automation", label: "กฎและพื้นที่", icon: Workflow },
      { href: "/auto-comment", label: "คอมเมนต์อัตโนมัติ", icon: MessageSquareText },
    ],
  },
  {
    id: "sources",
    label: "แหล่งข้อมูล",
    items: [
      { href: "/accounts", label: "จัดการบัญชี", icon: Users },
      { href: "/groups", label: "จัดการกลุ่ม", icon: Users },
      { href: "/sources", label: "แหล่งข้อมูล", icon: Rss },
      { href: "/parser", label: "ทดสอบตัวอ่าน", icon: Bug },
      { href: "/categories", label: "หมวดและคีย์เวิร์ด", icon: Tags },
    ],
  },
  {
    id: "system",
    label: "ระบบ",
    items: [
      { href: "/learn", label: "เรียนรู้", icon: Lightbulb },
      { href: "/guide", label: "วิธีใช้", icon: BookOpen },
      { href: "/settings", label: "ตั้งค่า", icon: Settings },
    ],
  },
];
```

- [ ] **Step 4: Implement nav-groups-state.ts**

```ts
import { NAV_GROUPS, type NavGroupId } from "./nav-config";

export const NAV_GROUPS_STORAGE_KEY = "mybot.nav.groups";

const DEFAULT_OPEN: Record<NavGroupId, boolean> = {
  start: true,
  leads: true,
  messages: false,
  automation: false,
  sources: false,
  system: false,
};

export function isNavItemActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/settings") return pathname.startsWith("/settings/");
  return false;
}

export function groupIdForPath(pathname: string): NavGroupId | null {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (isNavItemActive(pathname, item.href)) return group.id;
    }
  }
  return null;
}

export function readGroupOpenState(storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): Record<NavGroupId, boolean> {
  const base = { ...DEFAULT_OPEN };
  try {
    const raw = storage?.getItem(NAV_GROUPS_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<NavGroupId, boolean>>;
    for (const id of Object.keys(base) as NavGroupId[]) {
      if (typeof parsed[id] === "boolean") base[id] = parsed[id]!;
    }
  } catch {
    // ignore
  }
  return base;
}

export function writeGroupOpenState(state: Record<NavGroupId, boolean>, storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): void {
  try {
    storage?.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function resolveGroupOpen(groupId: NavGroupId, pathname: string, stored: Record<NavGroupId, boolean>): boolean {
  if (groupIdForPath(pathname) === groupId) return true;
  return stored[groupId];
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npx vitest run tests/pipeline/nav-groups.test.ts`

Expected: PASS

- [ ] **Step 6: Commit** (only if owner asks)

---

### Task 2: NavGroups UI component

**Files:**
- Create: `src/components/layout/nav-groups.tsx`
- Modify: `tests/pipeline/nav-groups.test.ts`

**Interfaces:**
- Consumes: `NAV_GROUPS`, state helpers, `cn`
- Produces: `NavGroups({ pathname, unread, onNavigate?: () => void })`

- [ ] **Step 1: Append failing UI test**

```ts
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { NavGroups } from "../../src/components/layout/nav-groups";

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
    expect(container.textContent).toContain("2");
    // leads forced open; system link may be hidden until toggled
    const systemButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("ระบบ"));
    expect(systemButton).toBeTruthy();
    await act(async () => { systemButton!.click(); });
    expect(container.textContent).toContain("ตั้งค่า");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
```

- [ ] **Step 2: RED then implement NavGroups**

Client component that:
1. Reads open state on mount
2. For each group, `open = resolveGroupOpen(id, pathname, stored)`
3. Group header `button` toggles stored state (and `writeGroupOpenState`)
4. Renders `Link` items when open; active styles: left accent bar + `bg-accent-soft`
5. Notifications badge when `unread > 0`
6. Calls `onNavigate?.()` on link click (for closing mobile drawer)

Visual classes (sidebar context — white text):

```tsx
// group header
"flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs text-white/55 hover:bg-white/5"
// item
cn(
  "relative flex items-center gap-2 rounded-lg py-2 pl-3 pr-3 text-sm",
  active ? "bg-accent-soft text-white" : "text-white/75 hover:bg-white/5",
)
// active bar
active && "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-accent"
```

Use `ChevronDown` rotated when open. Prefer `next/link` Link.

- [ ] **Step 3: GREEN**

Run: `npx vitest run tests/pipeline/nav-groups.test.ts`

Expected: PASS

- [ ] **Step 4: Commit** (only if owner asks)

---

### Task 3: AppShell pieces + wire layout

**Files:**
- Create: `src/components/layout/sidebar.tsx`
- Create: `src/components/layout/header.tsx`
- Create: `src/components/layout/mobile-nav.tsx`
- Create: `src/components/layout/main.tsx`
- Create: `src/components/layout/footer.tsx`
- Create: `src/components/layout/app-shell.tsx`
- Move logic: copy `ThemeToggle` to `src/components/layout/theme-toggle.tsx` (same code)
- Modify: `src/components/shell.tsx` → shim
- Modify: `src/components/theme-toggle.tsx` → shim
- Modify: `src/app/(app)/layout.tsx` to import `AppShell` from layout (optional; shim is enough)

**Interfaces:**
- `AppShell({ children })` — drop-in for `Shell`
- Preserve: StepUpPrompt, unread fetch, activity ping, logout, LiveUpdates usage via parent provider

- [ ] **Step 1: Implement layout pieces**

`sidebar.tsx` — desktop `aside` `hidden md:flex`, brand MY-BOT + one-line blurb (no LEAD RADAR tracking), `NavGroups`, bottom ThemeToggle + logout.

`header.tsx` — `md:hidden` sticky bar: menu button (`aria-expanded`, `aria-controls="mobile-nav"`), MY-BOT, ThemeToggle.

`mobile-nav.tsx` — when open: backdrop + panel `id="mobile-nav"` with NavGroups + logout; Escape/backdrop/onNavigate closes; restore focus to menu button.

`main.tsx` — `mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8`

`footer.tsx` — thin strip under main: version from `package.json` via small client prop or hardcode reading `process.env.npm_package_version` is unreliable in client — pass `version="1.3.7"` from a tiny export in `src/lib/build-info.ts` if one exists, else import package version in server layout… Footer can be a server-friendly static string using existing `build-info` module if present:

```bash
# check
rg -n "version" src/lib/build-info.ts | head
```

If `build-info` exports app version, use it; else footer text: `MY-BOT` + link to `/guide` only (no secret).

`app-shell.tsx` — migrate state/effects from current `shell.tsx`; grid `md:grid-cols-[260px_1fr]`; compose Sidebar/Header/MobileNav/Main/Footer; export `AppShell` and also `Shell` alias.

- [ ] **Step 2: Shims**

`src/components/shell.tsx`:

```ts
export { AppShell as Shell, AppShell } from "@/components/layout/app-shell";
```

`src/components/theme-toggle.tsx`:

```ts
export { ThemeToggle } from "@/components/layout/theme-toggle";
```

Update `tests/pipeline/theme.test.ts` imports if needed — shim keeps old path working.

- [ ] **Step 3: Focused tests**

Run:

```bash
npx vitest run tests/pipeline/nav-groups.test.ts tests/pipeline/theme.test.ts tests/pipeline/feed-lifecycle.test.ts
```

Expected: PASS (Shell still mounts)

- [ ] **Step 4: Commit** (only if owner asks)

---

### Task 4: Full verification

**Files:** none new

- [ ] **Step 1:** `npm test` — all pass including nav + theme + feed-lifecycle
- [ ] **Step 2:** `npm run build` — exit 0
- [ ] **Step 3:** Manual smoke checklist for owner report:
  1. Desktop: groups collapse/expand; active group forced open on `/feed`
  2. Mobile width: drawer opens/closes; no horizontal chip strip
  3. Theme toggle + unread + logout
  4. `/settings/security` highlights ตั้งค่า

- [ ] **Step 4:** Report acceptance; do not commit unless asked

---

## Follow-up (not this plan)

App-structure phases 2–6: `components/ui/*`, `features/*`, `services/*`, thin pages, delete unused shims, AGENTS.md note.

## Spec coverage

| Requirement | Task |
| --- | --- |
| Grouped collapsible nav + storage key | 1–2 |
| Radar Console active styles | 2–3 |
| Desktop sidebar + mobile drawer | 3 |
| AppShell Header/Sidebar/Main/Footer | 3 |
| Shim shell + theme-toggle | 3 |
| No URL changes / all hrefs present | 1 test |
| test + build gate | 4 |

## Self-review notes

- No TBD placeholders in steps
- `NavGroupId` / storage key names consistent
- Commits gated on owner request
