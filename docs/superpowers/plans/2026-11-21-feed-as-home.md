# Feed as Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/feed` the system home page in place of `/dashboard` (entry redirects + sidebar placement).

**Architecture:** Keep `/feed` and `/dashboard` routes. Change only default landing targets and move the nav item “ฟีดลีด” into the `start` group before “แดชบอร์ด”. Update nav-group tests so `/feed` maps to `start`.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, existing `nav-config.ts` / auth pages.

**Spec:** `docs/superpowers/specs/2026-11-21-feed-as-home-design.md`

## Global Constraints

- Reply to owner in Thai; code identifiers stay English.
- Do not change feed or dashboard page content/APIs.
- Do not remove `/dashboard`.
- Do not invent secrets; do not commit `.env`.
- Before any commit: `npm test` and `npm run build` must pass (AGENTS.md). Create git commits only when the owner explicitly asks.
- PWA `manifest.start_url` is already `/feed` — leave it.

## File map

| File | Role |
| --- | --- |
| `src/components/layout/nav-config.ts` | Sidebar groups; move `/feed` into `start` |
| `src/app/page.tsx` | `/` → `/feed` |
| `src/app/login/page.tsx` | Post-auth / already-auth → `/feed` |
| `src/app/setup/page.tsx` | Same |
| `src/app/reset-password/page.tsx` | Same |
| `src/app/not-found.tsx` | Home link → `/feed` |
| `tests/pipeline/nav-groups.test.ts` | Expect `/feed` under `start` |

---

### Task 1: Nav group membership (feed under start)

**Files:**
- Modify: `tests/pipeline/nav-groups.test.ts`
- Modify: `src/components/layout/nav-config.ts`
- Test: `tests/pipeline/nav-groups.test.ts`

**Interfaces:**
- Consumes: `NAV_GROUPS`, `groupIdForPath`, `resolveGroupOpen`, `NavGroups`
- Produces: `groupIdForPath("/feed") === "start"`; single `/feed` item in `start` items after `/overview` and before `/dashboard`

- [ ] **Step 1: Update failing expectations in the nav test**

In `tests/pipeline/nav-groups.test.ts`, change:

```ts
it("groupIdForPath finds the group containing the route", () => {
  expect(groupIdForPath("/feed")).toBe("start");
  expect(groupIdForPath("/settings/desktop")).toBe("system");
  expect(groupIdForPath("/nope")).toBe(null);
});

it("resolveGroupOpen forces open for the active group", () => {
  const stored = readGroupOpenState(window.localStorage);
  stored.start = false;
  expect(resolveGroupOpen("start", "/feed", stored)).toBe(true);
  expect(resolveGroupOpen("system", "/feed", stored)).toBe(stored.system);
});
```

And rewrite the last test so the active group is `start` (not `ลีด`):

```ts
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
    const startButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("เริ่มต้น"));
    expect(startButton).toBeTruthy();
    expect(startButton!.disabled).toBe(true);
    expect(startButton!.getAttribute("aria-disabled")).toBe("true");
    await act(async () => { startButton!.click(); });
    const stored = JSON.parse(window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY)!) as { start: boolean };
    expect(stored.start).toBe(false);
    expect([...container.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/feed")).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
```

Also add an assertion that feed sits in `start` once (optional clarity in the href-list test is already fine — keep the sorted href list unchanged).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/nav-groups.test.ts`

Expected: FAIL — `groupIdForPath("/feed")` still `"leads"`, and/or active-group button still expects ลีด.

- [ ] **Step 3: Move feed in nav-config**

Replace the `start` and `leads` groups in `src/components/layout/nav-config.ts` with:

```ts
  {
    id: "start",
    label: "เริ่มต้น",
    items: [
      { href: "/getting-started", label: "เริ่มใช้งาน", icon: Activity },
      { href: "/overview", label: "ภาพรวมระบบ", icon: Activity },
      { href: "/feed", label: "ฟีดลีด", icon: Radar },
      { href: "/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard },
    ],
  },
  {
    id: "leads",
    label: "ลีด",
    items: [
      { href: "/pipeline", label: "ไปป์ไลน์", icon: Bookmark },
      { href: "/summaries", label: "สรุปรายวัน", icon: Sun },
      { href: "/notifications", label: "การแจ้งเตือน", icon: Bell },
    ],
  },
```

Keep all other groups unchanged. Keep existing icon imports (`Radar` already imported).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline/nav-groups.test.ts`

Expected: PASS (all tests in that file).

- [ ] **Step 5: Commit only if owner asks**

If owner requested a commit:

```bash
git add src/components/layout/nav-config.ts tests/pipeline/nav-groups.test.ts
git commit -m "$(cat <<'EOF'
move feed into start nav as primary home entry

EOF
)"
```

Otherwise skip.

---

### Task 2: Default landing redirects

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/setup/page.tsx`
- Modify: `src/app/reset-password/page.tsx`
- Modify: `src/app/not-found.tsx`

**Interfaces:**
- Consumes: none new
- Produces: every previous `/dashboard` home redirect becomes `/feed`, except security gate on login (`weakPassword` / `mfaSetupRequired` → `/settings/security`)

- [ ] **Step 1: Change root redirect**

`src/app/page.tsx`:

```ts
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/feed");
}
```

- [ ] **Step 2: Change auth success / already-auth targets**

In `src/app/login/page.tsx` replace both `"/dashboard"` with `"/feed"`:

- `router.replace("/dashboard")` in the status `useEffect` → `"/feed"`
- success ternary else branch `"/dashboard"` → `"/feed"`

In `src/app/setup/page.tsx` replace both `"/dashboard"` with `"/feed"` (status + submit).

In `src/app/reset-password/page.tsx` replace both `"/dashboard"` with `"/feed"` (status + submit success). Leave `"/setup"` branches alone.

- [ ] **Step 3: Update 404 home link**

`src/app/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-sm text-muted">MY-BOT</p>
      <h1 className="mt-2 text-3xl font-semibold text-fg">ไม่พบหน้านี้</h1>
      <p className="mt-3 text-muted">ลิงก์อาจเก่า หรือยังไม่ได้สร้างไว้</p>
      <Link href="/feed" className="mt-6 text-fg underline">
        กลับหน้าแรก
      </Link>
    </main>
  );
}
```

- [ ] **Step 4: Grep for leftover home redirects**

Run: `rg 'replace\\("/dashboard"\\)|redirect\\("/dashboard"\\)|href="/dashboard"' src/app`

Expected: no matches in `page.tsx`, login, setup, reset-password, not-found. Other intentional links to dashboard (e.g. dashboard page itself) may remain elsewhere — that is fine.

- [ ] **Step 5: Commit only if owner asks**

If owner requested a commit:

```bash
git add src/app/page.tsx src/app/login/page.tsx src/app/setup/page.tsx src/app/reset-password/page.tsx src/app/not-found.tsx
git commit -m "$(cat <<'EOF'
land signed-in users on feed instead of dashboard

EOF
)"
```

Otherwise skip.

---

### Task 3: Full gate

**Files:** none new — verification only

- [ ] **Step 1: Run unit tests**

Run: `npm test`

Expected: PASS (exit 0).

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS (exit 0).

- [ ] **Step 3: Manual sanity (if local server available)**

1. Open `/` while signed in → lands on ฟีดลีด.  
2. Sidebar เริ่มต้น shows ฟีดลีด before แดชบอร์ด; ลีด has no ฟีดลีด.  
3. Login success (no security gate) → `/feed`.

- [ ] **Step 4: Commit only if owner asks**

Prefer one commit covering Tasks 1–2 if nothing was committed yet:

```bash
git add src/components/layout/nav-config.ts tests/pipeline/nav-groups.test.ts src/app/page.tsx src/app/login/page.tsx src/app/setup/page.tsx src/app/reset-password/page.tsx src/app/not-found.tsx docs/superpowers/specs/2026-11-21-feed-as-home-design.md docs/superpowers/plans/2026-11-21-feed-as-home.md
git commit -m "$(cat <<'EOF'
make feed the default home instead of dashboard

EOF
)"
```

---

## Spec coverage checklist

| Spec item | Task |
| --- | --- |
| `/` → `/feed` | Task 2 |
| Login / setup / reset → `/feed` (security gate unchanged) | Task 2 |
| 404 → `/feed` | Task 2 |
| Feed under เริ่มต้น before dashboard | Task 1 |
| Feed removed from ลีด | Task 1 |
| Dashboard kept | Task 1 (still in nav) |
| Nav test `groupIdForPath("/feed")` → `start` | Task 1 |
| `npm test` + `npm run build` | Task 3 |
| No feed/dashboard content changes | — out of scope |
| PWA start_url unchanged | — no task |
