# Feed as home page

Date: 2026-11-21  
Status: approved design

## Goal

Make **ฟีดลีด** (`/feed`) the system home page in place of **แดชบอร์ด** (`/dashboard`): entry redirects and sidebar placement.

## Behavior

| Entry | Destination |
| --- | --- |
| `GET /` | redirect → `/feed` |
| Login success | `/feed` (unless weak password / MFA setup → `/settings/security`) |
| Setup / reset-password success | `/feed` |
| Already-authenticated on login/setup/reset | `/feed` |
| 404 “กลับหน้าแรก” | `/feed` |

`/dashboard` and `/feed` URLs stay. Page content for both is unchanged.

## Sidebar (`nav-config.ts`)

**เริ่มต้น** order:

1. `/getting-started` เริ่มใช้งาน  
2. `/overview` ภาพรวมระบบ  
3. `/feed` ฟีดลีด (moved from ลีด)  
4. `/dashboard` แดชบอร์ด (kept, not home)

**ลีด** remaining: `/pipeline`, `/summaries`, `/notifications`.

PWA `manifest.start_url` is already `/feed` — no change.

## Out of scope

- Feed/dashboard UI or API changes  
- Removing dashboard  
- Docs marketing copy beyond what tests require  

## Tests

- `tests/pipeline/nav-groups.test.ts`: `groupIdForPath("/feed")` → `"start"`; active-group cases that used `/feed` under `leads` update accordingly. Href set still includes both `/feed` and `/dashboard`.  
- Login/setup/reset UI tests that assert post-auth destination update `/dashboard` → `/feed` if present.

## Acceptance

1. Opening `/` while signed in lands on feed.  
2. Fresh login lands on feed (security gate still wins when required).  
3. Sidebar shows ฟีดลีด under เริ่มต้น before แดชบอร์ด; not duplicated under ลีด.  
4. `npm test` and `npm run build` pass.
