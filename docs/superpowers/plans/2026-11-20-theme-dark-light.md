# Theme Dark / Light Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ MY-BOT มีโหมด dark/light สลับได้ทันที โดยโทเคนสีอยู่ที่ `globals.css` กลาง และเรียกผ่าน Tailwind ทั้งโปรเจกต์ ค่าเริ่มต้นเป็น dark

**Architecture:** CSS custom properties บน `html.dark` / `html.light` map เข้า Tailwind v4 `@theme` · สคริปต์สั้นกันแฟลชก่อน hydrate · `ThemeToggle` เขียน `localStorage.theme` · ชื่อโทเคนเก่า (`paper`/`ink`/`clay`/…) เป็น alias ชี้ค่าใหม่เพื่อไม่พังทั้งจอในรอบเดียว

**Tech Stack:** Next.js 15 App Router, Tailwind CSS v4, React 19, Vitest + jsdom, `geist` + `IBM_Plex_Sans_Thai` ผ่าน `next/font`

**Spec:** `docs/superpowers/specs/2026-11-20-theme-dark-light-design.md`

## Global Constraints

- Default theme = `dark` เมื่อไม่มีค่าใน `localStorage`
- Storage key = `theme` ค่าได้แค่ `"dark"` | `"light"` (ไม่มี system/auto)
- สีและโทเคนประกาศที่ `src/app/globals.css` ที่เดียว · UI เรียกผ่าน Tailwind utilities
- ไม่เพิ่ม next-themes หรือไลบรารีธีมอื่น
- ไม่เก็บธีมลง DB / หน้า settings
- ไม่แตะ extension / desktop package / Chrome profile
- ไม่รีดีไซน์เลย์เอาต์หน้า — เปลี่ยนเฉพาะสี/ฟอนต์/ปุ่มสลับ
- ก่อน commit โค้ด: `npm test` และ `npm run build` ต้องผ่าน (ตาม AGENTS.md)
- Commit เฉพาะเมื่อเจ้าของสั่ง

## File map

| File | Responsibility |
| --- | --- |
| `src/lib/theme.ts` | Pure helpers: resolve / toggle / apply / storage key |
| `tests/pipeline/theme.test.ts` | Unit tests สำหรับ helpers + ThemeToggle |
| `src/app/globals.css` | `@theme` tokens + dark/light values + aliases |
| `src/app/layout.tsx` | Fonts, anti-flash script, `html` class hook |
| `src/components/theme-toggle.tsx` | Client toggle button |
| `src/components/shell.tsx` | Place toggle (desktop + mobile) |
| `src/components/ui.tsx` | Buttons/inputs/badges ใช้โทเคนใหม่ / อ่านง่ายสองโหมด |
| `src/components/system-overview.tsx` | สถานะ ok/warn/bad ใช้โทเคน ไม่ hardcode emerald/red บนพื้นสว่างอย่างเดียว |
| `src/app/manifest.ts` | `theme_color` / `background_color` เข้าโทน dark default |
| `package.json` | เพิ่ม dependency `geist` |

---

### Task 1: Theme helpers (TDD)

**Files:**
- Create: `src/lib/theme.ts`
- Create: `tests/pipeline/theme.test.ts`

**Interfaces:**
- Produces:
  - `export type ThemeMode = "dark" | "light"`
  - `export const THEME_STORAGE_KEY = "theme"`
  - `export function resolveTheme(stored: string | null | undefined): ThemeMode`
  - `export function toggleTheme(current: ThemeMode): ThemeMode`
  - `export function applyTheme(mode: ThemeMode, root?: HTMLElement): void`
  - `export function readStoredTheme(storage?: Storage | null): ThemeMode`
  - `export function writeStoredTheme(mode: ThemeMode, storage?: Storage | null): void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/pipeline/theme.test.ts
import { afterEach, expect, it } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  readStoredTheme,
  resolveTheme,
  toggleTheme,
  writeStoredTheme,
} from "../../src/lib/theme";

afterEach(() => {
  document.documentElement.className = "";
  window.localStorage.removeItem(THEME_STORAGE_KEY);
});

it("resolveTheme defaults to dark unless stored light", () => {
  expect(resolveTheme(null)).toBe("dark");
  expect(resolveTheme(undefined)).toBe("dark");
  expect(resolveTheme("")).toBe("dark");
  expect(resolveTheme("nope")).toBe("dark");
  expect(resolveTheme("dark")).toBe("dark");
  expect(resolveTheme("light")).toBe("light");
});

it("toggleTheme flips between dark and light", () => {
  expect(toggleTheme("dark")).toBe("light");
  expect(toggleTheme("light")).toBe("dark");
});

it("applyTheme sets exactly one mode class on the root", () => {
  applyTheme("light", document.documentElement);
  expect(document.documentElement.classList.contains("light")).toBe(true);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  applyTheme("dark", document.documentElement);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.classList.contains("light")).toBe(false);
});

it("read/writeStoredTheme round-trips through localStorage", () => {
  expect(readStoredTheme(window.localStorage)).toBe("dark");
  writeStoredTheme("light", window.localStorage);
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  expect(readStoredTheme(window.localStorage)).toBe("light");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/theme.test.ts`

Expected: FAIL (cannot find module `../../src/lib/theme`)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/theme.ts
export type ThemeMode = "dark" | "light";

export const THEME_STORAGE_KEY = "theme";

export function resolveTheme(stored: string | null | undefined): ThemeMode {
  return stored === "light" ? "light" : "dark";
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  return current === "dark" ? "light" : "dark";
}

export function applyTheme(mode: ThemeMode, root: HTMLElement = document.documentElement): void {
  root.classList.remove("dark", "light");
  root.classList.add(mode);
}

export function readStoredTheme(storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): ThemeMode {
  try {
    return resolveTheme(storage?.getItem(THEME_STORAGE_KEY) ?? null);
  } catch {
    return "dark";
  }
}

export function writeStoredTheme(mode: ThemeMode, storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore quota / private mode
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline/theme.test.ts`

Expected: PASS (4 tests)

- [ ] **Step 5: Commit** (only if owner asks)

```bash
git add src/lib/theme.ts tests/pipeline/theme.test.ts
git commit -m "$(cat <<'EOF'
feat: add theme resolve helpers for dark/light mode

EOF
)"
```

---

### Task 2: Central Tailwind tokens in `globals.css`

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: palette hex values from the spec
- Produces: Tailwind colors `bg`, `fg`, `muted`, `card`, `line`, `sidebar`, `accent`, `accent-soft`, `warn`, `ok`, `danger` plus aliases `paper`, `ink`, `clay`, `clay-dark`, `pine`, `amber`

- [ ] **Step 1: Replace `src/app/globals.css` with token system**

Replace the entire file with:

```css
@import "tailwindcss";

:root,
html.light {
  --mybot-bg: #f7f9fc;
  --mybot-fg: #0b1220;
  --mybot-muted: #5b6b7c;
  --mybot-card: #ffffff;
  --mybot-line: #d7e0ea;
  --mybot-sidebar: #0e1622;
  --mybot-accent: #2f7fea;
  --mybot-accent-soft: #2f7fea18;
  --mybot-warn: #b8860b;
  --mybot-ok: #0f8a5f;
  --mybot-danger: #c62828;
  --mybot-selection: #2f7fea44;
}

html.dark {
  --mybot-bg: #0b0f14;
  --mybot-fg: #f4f7fb;
  --mybot-muted: #9aa6b2;
  --mybot-card: #121821;
  --mybot-line: #243041;
  --mybot-sidebar: #070a0f;
  --mybot-accent: #6eb6ff;
  --mybot-accent-soft: #6eb6ff22;
  --mybot-warn: #e6c35c;
  --mybot-ok: #3ddc97;
  --mybot-danger: #ff7b72;
  --mybot-selection: #6eb6ff55;
}

@theme inline {
  --font-sans: var(--font-geist), var(--font-ibm), "IBM Plex Sans Thai", ui-sans-serif, system-ui, sans-serif;

  --color-bg: var(--mybot-bg);
  --color-fg: var(--mybot-fg);
  --color-muted: var(--mybot-muted);
  --color-card: var(--mybot-card);
  --color-line: var(--mybot-line);
  --color-sidebar: var(--mybot-sidebar);
  --color-accent: var(--mybot-accent);
  --color-accent-soft: var(--mybot-accent-soft);
  --color-warn: var(--mybot-warn);
  --color-ok: var(--mybot-ok);
  --color-danger: var(--mybot-danger);

  /* Compatibility aliases for existing class names across the app */
  --color-paper: var(--mybot-bg);
  --color-ink: var(--mybot-fg);
  --color-clay: var(--mybot-accent);
  --color-clay-dark: var(--mybot-accent);
  --color-pine: var(--mybot-accent);
  --color-amber: var(--mybot-warn);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background-color: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-sans);
}

a {
  color: inherit;
}

::selection {
  background: var(--mybot-selection);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Notes for implementer:
- Do **not** keep the old cream dot background.
- `html` must get a class before first paint (Task 3). Until then, `:root` light values exist as CSS fallback but anti-flash script forces dark by default.

- [ ] **Step 2: Smoke-check that Tailwind still builds the CSS layer**

Run: `npx tailwindcss -i ./src/app/globals.css -o /tmp/mybot-theme-check.css --minify`  
If the CLI entry is unavailable in this repo, skip and rely on `npm run build` in Task 8.

Expected: exit 0, or proceed to next task if CLI not wired (Next build is the real gate).

- [ ] **Step 3: Commit** (only if owner asks)

```bash
git add src/app/globals.css
git commit -m "$(cat <<'EOF'
feat: centralize dark/light design tokens in globals.css

EOF
)"
```

---

### Task 3: Root layout — fonts + anti-flash

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `package.json` (add `geist`)

**Interfaces:**
- Consumes: `THEME_STORAGE_KEY` / `resolveTheme` semantics (inline script must match: only `"light"` → light, else dark)
- Produces: `--font-geist`, `--font-ibm` on the document; `html` starts with correct theme class

- [ ] **Step 1: Install Geist**

Run: `npm install geist`

Expected: `geist` appears in `package.json` dependencies

- [ ] **Step 2: Update `src/app/layout.tsx`**

Replace the file content with:

```tsx
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

// A fresh CSP nonce must reach every document, including login/setup.
export const dynamic = "force-dynamic";

const thai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MY-BOT เรดาร์ลีด",
  description: "เรดาร์ลีดส่วนตัวสำหรับกลุ่ม Facebook และบอร์ดประกาศ ใช้งานคนเดียวบนเครื่องตัวเอง",
  icons: { apple: "/apple-touch-icon.png" },
};

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");document.documentElement.classList.add(t==="light"?"light":"dark");}catch(e){document.documentElement.classList.add("dark");}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The installed extension marks this element before hydration; child content must still match.
    <html lang="th" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${GeistSans.variable} ${thai.variable} font-sans antialiased`}>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
```

Notes:
- `GeistSans.variable` must equal `--font-geist` (the `geist` package sets this). If the package exposes a different variable name, set `variable: "--font-geist"` via the package API or assign `className` + CSS bridge — verify against `node_modules/geist` docs after install. If `GeistSans.variable` is already `--font-geist`, keep as-is.
- Keep `suppressHydrationWarning` on `<html>`.
- Default `className="dark"` on `<html>` covers no-JS; script still overrides from storage.

- [ ] **Step 3: Typecheck layout compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`

Expected: no errors related to `geist/font/sans` or `layout.tsx`. If `GeistSans.variable` is not `--font-geist`, fix `globals.css` `--font-sans` or the font import before continuing.

- [ ] **Step 4: Commit** (only if owner asks)

```bash
git add package.json package-lock.json src/app/layout.tsx
git commit -m "$(cat <<'EOF'
feat: load Geist/IBM fonts and apply stored theme before paint

EOF
)"
```

---

### Task 4: ThemeToggle component + UI test

**Files:**
- Create: `src/components/theme-toggle.tsx`
- Modify: `tests/pipeline/theme.test.ts`

**Interfaces:**
- Consumes: `readStoredTheme`, `writeStoredTheme`, `applyTheme`, `toggleTheme`, `ThemeMode` from `@/lib/theme`
- Produces: `<ThemeToggle className?: string />` client component

- [ ] **Step 1: Append failing UI test**

Add to `tests/pipeline/theme.test.ts`:

```ts
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeToggle } from "../../src/components/theme-toggle";

it("ThemeToggle flips document class and localStorage", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.className = "dark";
  window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(ThemeToggle));
    });
    const button = container.querySelector("button");
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    await act(async () => {
      button!.click();
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
```

Also add `import { vi } from "vitest"` (or extend the existing vitest import) and put `// @vitest-environment jsdom` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/theme.test.ts`

Expected: FAIL (cannot find `theme-toggle`)

- [ ] **Step 3: Implement ThemeToggle**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ThemeMode,
  applyTheme,
  readStoredTheme,
  toggleTheme,
  writeStoredTheme,
} from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("dark");

  useEffect(() => {
    const next = readStoredTheme();
    setMode(next);
    applyTheme(next);
  }, []);

  function onToggle() {
    const next = toggleTheme(mode);
    setMode(next);
    applyTheme(next);
    writeStoredTheme(next);
  }

  const label = mode === "dark" ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-card text-fg hover:bg-accent-soft",
        className,
      )}
    >
      {mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/pipeline/theme.test.ts`

Expected: PASS (helpers + ThemeToggle)

- [ ] **Step 5: Commit** (only if owner asks)

```bash
git add src/components/theme-toggle.tsx tests/pipeline/theme.test.ts
git commit -m "$(cat <<'EOF'
feat: add ThemeToggle for dark/light switching

EOF
)"
```

---

### Task 5: Wire toggle into Shell + refresh `ui.tsx`

**Files:**
- Modify: `src/components/shell.tsx`
- Modify: `src/components/ui.tsx`

**Interfaces:**
- Consumes: `ThemeToggle`
- Produces: toggle visible on desktop sidebar and mobile header; UI primitives use accent/ok/warn/danger tokens

- [ ] **Step 1: Update shell placement**

In `src/components/shell.tsx`:
1. Import `ThemeToggle` from `./theme-toggle`.
2. Desktop: above the logout button (after `</nav>`), add a row:

```tsx
<div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2">
  <span className="text-xs text-paper/70">ธีม</span>
  <ThemeToggle className="border-white/15 bg-white/5 text-paper hover:bg-white/10" />
</div>
```

3. Mobile header: put toggle next to logout:

```tsx
<div className="flex items-center gap-2">
  <ThemeToggle />
  <button onClick={logout} className="text-sm text-muted">ออก</button>
</div>
```

4. Keep existing `bg-sidebar` / `text-paper` / active nav styles; aliases make them follow the new palette. Change active mobile chip from clay white text if needed:

```tsx
pathname === item.href ? "border-accent bg-accent text-white" : "border-line bg-card text-fg",
```

(Optional but preferred — `bg-clay` still works via alias.)

- [ ] **Step 2: Update `src/components/ui.tsx` variants**

Replace `buttonVariants` and badge/input focus colors so they work on both themes:

```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:opacity-90",
        outline: "border border-line bg-card text-fg hover:bg-accent-soft",
        ghost: "text-fg hover:bg-accent-soft",
        pine: "bg-accent text-white hover:opacity-90",
        danger: "border border-danger/40 bg-card text-danger hover:bg-danger/10",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
```

Input / Textarea / Select focus:

```tsx
"h-10 w-full rounded-lg border border-line bg-card px-3 text-sm text-fg outline-none ring-accent focus:ring-2"
```

Badge tones:

```tsx
const tones = {
  neutral: "bg-accent-soft text-fg",
  pine: "bg-ok/15 text-ok",
  clay: "bg-accent-soft text-accent",
  amber: "bg-warn/20 text-warn",
  danger: "bg-danger/15 text-danger",
};
```

Keep the public `tone` prop names (`pine` | `clay` | `amber`) unchanged so callers do not break.

- [ ] **Step 3: Focused test — shell still mounts**

Run: `npx vitest run tests/pipeline/feed-lifecycle.test.ts tests/pipeline/theme.test.ts`

Expected: PASS (or only pre-existing unrelated failures — if Shell test fails on ThemeToggle, fix import/SSR).

- [ ] **Step 4: Commit** (only if owner asks)

```bash
git add src/components/shell.tsx src/components/ui.tsx
git commit -m "$(cat <<'EOF'
feat: wire theme toggle into shell and refresh UI tokens

EOF
)"
```

---

### Task 6: Status surfaces that hardcode light-only colors

**Files:**
- Modify: `src/components/system-overview.tsx` (required)
- Modify as needed where light-only status chips break dark readability: prefer `text-danger`, `text-ok`, `text-warn`, `border-line`, `bg-accent-soft` over `text-red-700`, `bg-emerald-50`, `bg-amber-50`

**Interfaces:**
- Consumes: `ok` / `warn` / `danger` Tailwind colors
- Produces: overview status chips readable in both themes

- [ ] **Step 1: Update LEVEL_STYLE in system-overview**

Replace the `LEVEL_STYLE` map roughly with:

```ts
const LEVEL_STYLE = {
  ok: { dot: "bg-ok", card: "border-ok/30 bg-ok/10", text: "text-ok", label: "ปกติ" },
  warn: { dot: "bg-warn", card: "border-warn/30 bg-warn/10", text: "text-warn", label: "ควรดู" },
  bad: { dot: "bg-danger", card: "border-danger/30 bg-danger/10", text: "text-danger", label: "มีปัญหา" },
  off: { dot: "bg-muted", card: "border-line bg-card", text: "text-muted", label: "ไม่ได้ใช้" },
} as const;
```

Also change any `text-clay` link there to `text-accent`.

- [ ] **Step 2: Spot-fix remaining painful hardcodes on auth surfaces**

In these files only (auth + shell-adjacent), replace obvious light-only error text:
- `src/app/login/page.tsx` — `text-clay` → `text-accent`; `text-red-700` → `text-danger`
- `src/app/setup/page.tsx` — same pattern
- `src/app/reset-password/page.tsx` — same pattern
- `src/app/not-found.tsx` — ensure `text-muted` / `text-fg` only

Do **not** mass-rewrite every page in this task. Aliases already remap `paper`/`clay`/`pine`/`amber`. Only fix hardcode Tailwind palette classes that stay light-theme (red-700, emerald-50, amber-50) when they appear on the files above or block readability of overview.

- [ ] **Step 3: Run related tests**

Run: `npx vitest run tests/pipeline/system-overview.test.ts tests/pipeline/theme.test.ts`

Expected: PASS

- [ ] **Step 4: Commit** (only if owner asks)

```bash
git add src/components/system-overview.tsx src/app/login/page.tsx src/app/setup/page.tsx src/app/reset-password/page.tsx src/app/not-found.tsx
git commit -m "$(cat <<'EOF'
fix: make status and auth surfaces readable in dark theme

EOF
)"
```

---

### Task 7: Manifest theme colors

**Files:**
- Modify: `src/app/manifest.ts`

- [ ] **Step 1: Update colors to dark default**

```ts
background_color: "#0B0F14",
theme_color: "#6EB6FF",
```

- [ ] **Step 2: Commit** (only if owner asks)

```bash
git add src/app/manifest.ts
git commit -m "$(cat <<'EOF'
chore: align PWA theme colors with dark default

EOF
)"
```

---

### Task 8: Full verification

**Files:** none new — verify only

- [ ] **Step 1: Run unit tests**

Run: `npm test`

Expected: all suites pass (or only pre-existing skips). New theme tests must pass.

- [ ] **Step 2: Production build**

Run: `npm run build`

Expected: exit 0. Next compiles `layout.tsx` + CSS without errors.

- [ ] **Step 3: Manual smoke (local server already on :8001 or restart `npm run start:prod`)**

Check:
1. Open `/login` — dark by default, blue accent, no cream background
2. Click theme toggle after login — flips to light, persists after refresh
3. Sidebar + cards + buttons readable in both modes
4. No white flash on hard reload while dark is selected

- [ ] **Step 4: Report acceptance to owner**

List what passed / any leftover hardcode pages that still look slightly off (aliases cover most). Do not commit unless owner asks.

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Central `globals.css` tokens + Tailwind | Task 2 |
| Dark/light palette + warn/ok/danger | Task 2 |
| Aliases paper/ink/clay/pine/amber | Task 2 |
| Geist + IBM Plex Sans Thai | Task 3 |
| Anti-flash + default dark | Task 1 + 3 |
| localStorage key `theme` | Task 1 + 4 |
| Toggle in shell desktop + mobile | Task 5 |
| ui.tsx primitives | Task 5 |
| Status surfaces | Task 6 |
| Manifest colors | Task 7 |
| test + build gate | Task 8 |
| No DB/settings/system mode/extension | Global Constraints |

## Self-review notes

- No TBD placeholders in steps
- `THEME_STORAGE_KEY` / `ThemeMode` names consistent across tasks
- Inline anti-flash script mirrors `resolveTheme` (`"light"` only → light)
- Commit steps gated on owner request per repo user rules
