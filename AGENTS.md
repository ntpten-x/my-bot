# AGENTS.md

Source of truth for any coding agent opening this repo. The human guide is `docs/SETUP.th.md` (Thai). The in-app page is **วิธีใช้** (`/guide`).

Thai notes: the product UI, seed copy, and owner-facing docs are Thai. Reply to the owner in Thai. Keep code identifiers and PowerShell in English.

## What this is

MY-BOT is a local, single-owner lead radar. The owner logs into Facebook in Chrome. The extension sends group posts to this app. Browser comment delivery is an explicit owner opt-in (see docs/BROWSER-COMMENTS.th.md). The app dedupes, scores, classifies (buyer / seller / ad), and drafts a reply the owner copies by hand.

Stack: Next.js App Router, TypeScript, Tailwind, Prisma on Supabase Postgres (`DATABASE_URL` transaction pooler 6543 with `pgbouncer=true`, `DIRECT_URL` 5432 for migrations, RLS on every table), an in-process Node worker. Default web port **8001**. AI order: Ollama, then Gemini, then Groq, then rules. Only the worker consumes the AI queue (`MYBOT_PROCESS=worker`).

## Architecture

| Path | Role |
| --- | --- |
| `src/app/(app)` | Signed-in pages: overview (ภาพรวมระบบ), dashboard, feed, pipeline, sources, parser, categories, learn, summaries, notifications, guide, settings |
| `src/app/api` | Session routes. `src/app/api/v1` is the extension and health surface |
| `src/lib/pipeline` | Normalize, intent, ads, categories, rules |
| `src/lib/ai` | Provider chain, queue, Ollama URL, warm-up |
| `src/lib/smart` | Score, embeddings, near-duplicates, hybrid search |
| `src/lib/ingest.ts` | Insert posts and enqueue AI. It does not run the queue |
| `src/worker/index.ts` | Cron: RSS, summaries, backup, queue, embedding backfill |
| `extension/` | Chrome MV3, read-only |
| `prisma/` | Schema, migrations, seed |
| `scripts/windows/` | ASCII PowerShell for a fresh Windows PC |
| `scripts/setup.sh` | Linux/macOS setup (`npm run setup` picks the OS script) |
| `data/` | Logs, JSON backups, legacy `mybot.db` (pre-Supabase). Gitignored |
| `tests/` | Vitest |

Logs: `data/mybot.log` (worker JSON lines) and `data/mybot-console.log` (launcher stdout). A failed log write must not fail a job.

## First run on a fresh machine

Done when `npm run doctor` has no FAIL, `GET http://127.0.0.1:8001/api/v1/health` returns `{ ok: true, version }`, and the owner can open the app.

1. Prereqs: Git, Node.js 20 LTS, Chrome. Ollama is optional and preferred for local classify plus embeddings. Windows setup installs Node and Git with winget when they are missing.
2. Windows: `powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1`. Elsewhere: `bash scripts/setup.sh` or `npm run setup`.
3. Secrets: copy `.env.example` to `.env` if the script did not. Ask the owner for each value below. Enter skips a key. Write them only into `.env` or the settings screen. Never print a full key back, and never commit `.env`.
   - `GROQ_API_KEY`, `GROQ_MODEL` (default `openai/gpt-oss-120b`; the app picks another model from the account if that id is missing)
   - `GEMINI_API_KEY`
   - `DISCORD_WEBHOOK_URL`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_USER_ID`
   - SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFY_EMAIL_TO`
4. Ollama listens on `127.0.0.1:11434`. If Windows has reserved that port, use `41434`. Set these on the **ollama serve** process, then start Ollama again: `OLLAMA_HOST`, `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_KEEP_ALIVE=30m`. Put `OLLAMA_BASE_URL` in `.env` (`http://127.0.0.1:11434` or `http://127.0.0.1:41434`). The app probes 11434, then 41434.
5. Models: chat `qwen2.5:7b` (or `qwen2.5:3b` when VRAM is tight) and embed `bge-m3` (`ollama pull`). Gemini embed fallback is `text-embedding-004`.
6. `npm install`, `npm run db:migrate`, `npm run db:seed`, `npm run build`. Seed is safe to repeat.
7. Autostart (Windows, optional): the setup script can write `Startup\MY-BOT.vbs`, or run `scripts\windows\install-service.ps1`. The launcher starts Ollama hidden, then `node scripts\start-all.mjs --prod`, and appends the console to `data/mybot-console.log`. Remove with `scripts\windows\uninstall-service.ps1`.
8. Extension: Chrome → `chrome://extensions` → developer mode → Load unpacked → `extension/`. App URL `http://localhost:8001`. The owner sets the password on `/setup`, then copies the extension token from **ตั้งค่า**. Seed and setup scripts only print a masked token.

## Verify

- `npm run doctor` — PASS / WARN / FAIL, no secrets in the output. The same checks sit behind the signed-in `GET /api/v1/health/doctor`.
- `GET /api/v1/health` — public, body is only `ok` and `version`.
- **ภาพรวมระบบ** (`/overview`, signed-in `GET /api/system/overview`, `?fresh=1` re-tests cloud AI) — Facebook accounts from the extension heartbeat (`c_user` id only), extension version/token/tabs, Ollama/Groq/Gemini live checks (cached 5 min), worker, schedules, notifications, disk. Secrets are always masked. The extension (v1.4.0) POSTs `/api/v1/extension/heartbeat` every minute.
- `npm test` and `npm run build` — both must finish clean before a commit.

## Commands

| Command | Use |
| --- | --- |
| `npm run dev` | Web + worker, port 8001 |
| `npm run start:prod` | Production web + worker (`node scripts/start-all.mjs --prod`) |
| `npm test` / `npm run build` | Tests, then Prisma generate and Next build |
| `npm run doctor` | Local health report |
| `npm run browser:desktop` | WSL virtual display; `--password` is interactive owner input, `--check` is read-only |
| `npm run bot:start` / `npm run bot:status` / `npm run bot:stop` | WSL workstation supervisor: web + isolated desktop, no extra worker |
| `npm run bot:install-service` | Install the WSL systemd user supervisor; Windows logon launcher is separate |
| `npm run browser:bot` | Launch isolated persistent Chrome profile on the bot workstation; docs/BOT-WORKSTATION.th.md |
| `npm run db:migrate` | `prisma migrate deploy` |
| `npm run db:seed` | Categories, keywords, demo source (disabled) |
| `npm run db:backfill-ai` | Enqueue posts still on rules. The worker classifies them |
| `npm run db:backfill-embeddings` | Fill missing vectors |
| `npm run db:clean-samples` | Delete posts from the disabled sample source |
| `npm run db:renormalize` | Rebuild Thai normalized text and hashes |

Backup: the worker exports every table after 03:00 Asia/Bangkok once per day to `data/backups/YYYY-MM-DD.json.gz` and keeps 14 days. `npm run db:backup` makes a manual export; `npm run db:restore -- <file> --check` validates without a database, and `--replace` restores atomically (stop all app/worker hosts first). Legacy v1 backups require `--allow-legacy`. `npm run db:migrate-from-sqlite` is the one-time SQLite to Postgres copy (Node 22.5+). DB tests run in a throwaway `test_*` schema using explicitly configured `TEST_DATABASE_URL` only and skip without one; never fall back to production credentials. Never commit `.env`. Daily summary runs after the configured time (default 08:00) once per day. New migrations must stay Postgres and add `ENABLE ROW LEVEL SECURITY` for new tables.

## Update an existing machine

```powershell
git pull
npm install
npm run db:migrate
npm run build
```

Restart the app (or the Startup launcher). Then, if older posts need it: `npm run db:seed` (keyword refresh), `npm run db:backfill-ai`, `npm run db:backfill-embeddings`.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Port 11434 excluded on Windows | `OLLAMA_HOST=127.0.0.1:41434`, restart `ollama serve`, set `OLLAMA_BASE_URL` to match |
| Ollama swaps the chat and embed models | `OLLAMA_MAX_LOADED_MODELS=2` and `OLLAMA_KEEP_ALIVE=30m` on `ollama serve`, then restart it |
| `npm run doctor` fails on the database | `npm run db:migrate` while the app is stopped |
| Cannot reach database (P1001/auth failed) | Check internet, the Supabase password in `.env`, and that the project is not paused |
| Embeddings stay empty | `ollama pull bge-m3`, Settings → test embedding, then `npm run db:backfill-embeddings` |
| Posts stay on rules | Worker must be running. `npm run db:backfill-ai` only enqueues |
| AI job stuck `running` | Worker resets jobs older than 2 minutes. OCR runs only in the worker; a bad image does not fail classification |
| Extension posts nothing | Token matches Settings, base URL is port 8001, Chrome is logged into Facebook, the group is enabled |
| PowerShell parse error | `scripts/windows/*.ps1` are ASCII. Save as ASCII, or run with `-ExecutionPolicy Bypass -File` |
| Seed `P2002` | Pull latest. Seed upserts demo posts |

## Cloud deploy (Render)

- https://my-bot-e6bt.onrender.com, auto-deploys on push to `master`. Health check path: `/health`. Full Thai guide: `docs/RENDER.th.md`.
- Required env on Render: `DATABASE_URL`, `DIRECT_URL`, `AI_KEY_SECRET` (same value as local `.env`; production refuses to start without it), `NODE_ENV=production`. Optional: `GROQ_API_KEY`, `GEMINI_API_KEY` (cloud embeddings), `OLLAMA_DISABLED=1`.
- Free tier sleeps after ~15 min idle; first request takes 30–60 s.
- The Supabase DB is shared by local and Render: run migrations once (`npm run db:migrate`); never put per-host state (e.g. Ollama cooldowns) in the DB. Ollama rows are skipped, not cooled down, when unreachable.
- Extension (>=1.5.0) pairs per device: web Settings → ส่วนขยาย Chrome → pairing code (10 min, one-time) → popup exchanges it for an `mbd_` token (stored hashed, revocable). Device tokens require HTTPS or localhost; the legacy shared token is accepted from localhost only.
- Never put secrets in `NEXT_PUBLIC_*`. Don't change the owner's password; the security page only warns and lets them change it.

## Hard rules

- `data/bot-desktop/` and `data/desktop-browser-profile/` contain X/VNC authority and browser credentials. Keep ignored. `browser:desktop` runs an authenticated loopback virtual desktop in WSL/Linux; never expose ports 5905/6085 beyond localhost, disable sandbox, or enable comments as part of setup. See docs/SINGLE-PC-BOT.th.md.

- `data/browser-profile/` contains Chrome cookies, sessions and paired-device credentials. Keep it ignored; never print, commit or include it in general backups. `browser:bot` is a manual launcher, not a headless runtime or permission to enable comments.

- Commit `.env.example` only. Leave `.env`, `data/*.db`, `data/*.log`, `data/backups/`, and `*.traineddata` untracked.
- The extension reads posts the owner can already see and POSTs them to this app. Per the latest owner instruction, optional browser comment delivery uses visible UI only, with per-rule consent, pinned device/account, live-only UI controls, quotas, durable sending and no ambiguous retries. It never calls private GraphQL, bypasses CAPTCHA/checkpoints or posts outside the configured group allowlist. See docs/BROWSER-COMMENTS.th.md.
- **Scrape scheduling (v1.11.0)** — `GET /api/v1/extension-config` (`src/lib/scrape-runs.ts`) returns enabled `facebook_group` + `facebook_marketplace` sources with due/knownKeys and scroll settings. Hints cover every due source, bounded to 300 rows/source and 4 concurrent queries. Priority defaults remain สูง/ปกติ/ต่ำ = 3/10/30 min. `max_posts_per_run` (5–200) is now a durable batch threshold, not a stop cap; transport batches stay ≤40. The extension scrolls with `scrollTop` only (no clicks or Facebook APIs), sends during discovery, checkpoints pending posts locally per server/account, and keeps the DOM cursor in a dedicated reader tab on time/scroll yield. Limit/cap/yield are incomplete and enqueue continuation in ~30 seconds, subject to quiet settings and other groups. Active reads stay ≤2, or 1 while throttled/coverage; parked cursors stay ≤20, overflow readers release their temporary tabs on yield without evicting existing cursors. MV3 restarts adopt saved readers; full Chrome restart/discard uses the durable recovery flag and pending posts. Deep catchup/sweep/audit never stop on known head posts; old boundaries require 12 ordered old dates in deep modes. No growth is verified with a wake/nudge before `exhausted`; loading/stalled remain incomplete with normal retry spacing. Group ordering interleaves normal sources and ages overdue ones. Full-text runs after discovery. Overview metrics include capture rate, incomplete/error slices, pending age and overdue sources, scoped to the expected extension version. Pure logic: `src/lib/scrape-plan.ts`, `src/lib/scrape-hints.ts`, `extension/scrape.js`; post keys must stay identical. See `docs/SCRAPE-FIXES.th.md` for verification and recovery limits.
- **Marketplace sources** — search/category URLs (`/marketplace/...`, not `/marketplace/item/`) are canonicalized without `sortBy`; listing cards (title, price, location, image) become posts with intent `seller`. Parser fixtures in `extension/fixtures/` marked SYNTHETIC are hand-written, not captured from Facebook.
- Leave audio devices and OS sound settings alone.
- `scripts/windows/*.ps1` stay ASCII so Windows PowerShell 5.1 can parse them.
- Run `npm test` and `npm run build` before every commit. Fix failures first.
- Ask the owner for secrets. Do not invent keys, and do not put secrets in git, logs, or chat transcripts.

## Reader and AI reliability update (extension v1.11.1)

- The v1.11.0 scheduling description above is extended by v1.11.1: each group shares a 45-second deadline across discovery, recovery, outbox and reporting; the cycle budget is 3 minutes. Productive continuations are due in 30 seconds; loading/stalled recovery is due in 60 seconds, subject to quiet settings and queued groups. Preserve no-progress checks across slices. Reader scripts have host-side timeouts; timeouts do not cancel every operation Chrome already accepted.
- Detect visible loaders only inside the relevant feed/main, excluding hidden UI, dialogs, sidebars and media inside articles. Use the actual scrollable ancestor for nested feeds and small relative nudges; never jump to the end to recover. Keep pending posts/checkpoints on timeout.
- Quota/cooldown/minute limits and HTTP 429 are deferred AI work, not job failure attempts. Carry structured retryAt/deferred metadata; wait until all restrictions on one provider expire and choose the earliest usable provider. Honor Retry-After. Actual classification failures retain the 10-attempt cap and claim/lease fencing. Do not automatically reset historical failed jobs or change owner quotas.
- Worker classification, public health, watchdog and overview use the same classification plan. Read-only availability must not seed the provider registry. A successful key/model probe must not override an active routing quota/cooldown. See `docs/RELIABILITY-FIXES-1.11.1.th.md` and the synthetic browser verifier.

## Optional Auto Comment Engine

Current runtime uses Extension delivery matching `extension/manifest.json` (currently 1.11.24) per the owner's latest instruction; see `docs/BROWSER-COMMENTS.th.md`. Graph transport below is retained only for legacy regression tests and is not invoked by normal worker ticks. Browser grants already issued may still click for up to 3 seconds after Stop; never promise immediate distributed cancellation. Do not send real Facebook comments without separate explicit approval.


Owner-enabled server-side Graph API comments live in `src/lib/auto-comment`, `/api/auto-comment`, and `/auto-comment`. Default is stopped with live-only delivery per the latest owner instruction. The UI and public control API cannot enable Dry Run; internal legacy simulation remains only for regression tests. Never auto-start or convert historical simulated jobs into live jobs. Only worker consumes jobs. Allow only verified Page-owned published posts through official API; groups/Marketplace remain unsupported drafts. Collector and assisted replies stay read-only; only the separately opted-in browser comment worker may click a verified comment submit button. Keep durable sending markers, global control locks, generation/revision fencing and unique live post keys; ambiguous sends must never auto-retry. Backup includes all four AutoComment tables and Restore must disable automation. See `docs/AUTO-COMMENT.th.md` for capability limits, safe rollout, rollback and validation. Tests must use mock Meta transport and disposable TEST_DATABASE_URL, never actual comment sends.

## Central comment control (extension 1.11.9)

Per the owner instruction, paired device tokens make the extension eligible to claim comments automatically. The obsolete local browserCommentsEnabled flag no longer gates delivery. Server control/rule consent, pinned device/account, allowlist, quotas and final authorize remain mandatory. The popup collection pause only affects collection; stop comments from /auto-comment or account pause. This change is not permission to grant Chrome host permissions silently or bypass browser/Facebook restrictions.

## Automatic bot tab cleanup (extension 1.11.11)

Close unused bot-owned reader/comment tabs automatically. Keep active readers and needed continuations; release inactive parked readers when collection/account is paused without deleting durable pending recovery. Remove only the known blank container tab when no readers remain, never an entire window containing personal tabs. Failed tab removal keeps ownership for retry. Comment recovery uses session-owned tab IDs, never a matching personal Facebook tab; preserve uncertain-send journals and never resend to recover a tab. Ownership does not survive a full Chrome restart or extension reload; do not infer ownership of unknown tabs from their URL. See docs/BOT-TAB-CLEANUP.th.md.

## Database-first comment delivery (extension 1.11.12)

Select comments only from stored Post rows and durable evaluations, never a second Facebook feed discovery pass. Extension drain is sequential, at most 3 observed-and-acknowledged jobs per 90-second wake, with a fresh claim/authorize for each and no quota changes. Bound page work by claim expiry and reserve report time. Worker scan/preparation use independent cooperative slices, retaining checkpoints. Retry preparation at most twice (30/60 seconds) only under the control lock for claimed work with attempts=0, dispatchedAt=null and a current running generation; rotate claim tokens and preserve live dedupe keys. Never retry dispatched, uncertain or blocked work automatically. See docs/COMMENT-PIPELINE-1.11.12.th.md.

## Automatic extension connection (extension 1.11.13)

Authenticated downloads package only the public server origin in install-config.json plus explicit manifest host matches, never tokens or pairing codes. Fresh install opens that app; after owner login an isolated content script registers only a worker-generated pending token hash via the same-origin, session-authenticated connect endpoint. The raw device token never crosses into the page. Bind completion to origin/main-frame/tab/nonce/hash, retain the pending fingerprint across lost responses, never revive revoked hashes or overwrite existing pairing/pause. Keep Start, rule consent, device/account pinning and quotas unchanged. No silent optional-host grant. Manual code pairing remains an advanced fallback. See docs/EXTENSION-AUTO-CONNECT.th.md.

## Reader budgets and scan snapshots (extension 1.11.14)

Full-text work shares the parent cycle deadline through navigation, injection, DOM reads and outbox flush. Durable enqueue precedes removing full-text recovery. Host timeouts cannot cancel Chrome operations already accepted; retain recovery and tab ownership. Comment scans cache templates only within one slice, rechecking the ordered eligible rule id/revision/rotation manifest under the control lock for every post; refresh on changes and keep final claim/authorize checks. Observation summaries report gaps/errors and online versions, never infer stability from absent current-version heartbeats or missing comment samples. See docs/AUTOMATION-RELIABILITY-1.11.14.th.md.

## Tab lifecycle (extension 1.11.15)

Full-text opens its known target once and keeps matching session ownership. Shared `extension/tab-lifecycle.js` distinguishes closed/gone/released/retry: never drop ownership on a failed tab lookup; query fallback can confirm absence of an already owned ID only. Close retries back off 30/60/120/300 seconds and keep consuming the bounded reader pool. Register active tabs before returning from creation; cleanup skips active and needed parked cursors and remembers all session-owned blank containers without closing personal windows. After three loading/stalled/limit slices with no DOM progress, release the stalled reader but retain durable recovery; known-post traversal is progress. Popup-only cleanup never claims/authorizes/sends comments. Heartbeat/overview expose aggregate reasons, treating stale or wrong-version data as unknown. Never infer ownership of old tabs after a full Chrome restart or extension reload. See docs/BOT-TAB-LIFECYCLE-DESIGN.th.md.

## Visible feed capture (extension 1.11.16)

Visible personal group/Marketplace tabs observe relevant DOM mutations with a 500ms coalesced wake, stable post keys, bounded pending/seen caches and <=40 transport batches. Acknowledge only durable enqueue; preserve pending until accepted and original observedAt on retry. Background dedupe is per post/content/server/token/account, never a per-source 20-second drop gate. Managed readers keep their existing checkpoint path. Do not change quiet/account/quotas, default group intervals or use clicks/private Facebook APIs to claim instant detection. Capture-to-ingest timing is browser-clock-dependent and is not publish-to-capture latency. SSE uses createdAt/id keyset pagination, serial polls and abort/cancel cleanup; reconnect repairs with a full filtered fetch. See docs/LIVE-CAPTURE-1.11.16.th.md.

## Workstation supervision (extension 1.11.18)

`bot:start` supervises local web and the isolated desktop without starting a worker. Adopted existing services are monitored, never killed. Only owned web processes may be restarted after bounded health checks/backoff. Recover viewer/Openbox processes without reopening Chromium; Chromium/Xvfb loss latches for owner review and `bot:resume-desktop`, never automatic comment retry. Repair MV3 alarms by name/period, not count. Watchdog collection runtime must match the fresh heartbeat install/version; intentional pauses are off, missing telemetry is unknown. Keep user service and Windows WSL logon launcher scoped to MY-BOT. See docs/AUTONOMOUS-WORKSTATION.th.md.

## Optional Desktop package (extension 1.11.24)

`/settings/desktop` and authenticated `/api/desktop-download` package a production-only Windows 11 x64 preview collector (`0.1.5-preview`), never an app/database/worker installation. Bundle only allowlisted public runtime files and origin, never credentials. Optional `DESKTOP_PUBLIC_ORIGIN` pins the ZIP origin. Installer owns only `MYBOT-Desktop-V1` and requires `/etc/mybot-desktop-owner`; do not touch existing distros, change the default distro, globally shut down WSL or change OS power/audio settings. Keep mutable profiles outside immutable releases (atomic staging + complete marker), retain stable extension public identity, and preserve pairing/pause on update. Purge/unregister and rollback must re-check ownership. Desktop focus opt-in applies only to a fresh explicitly installed Desktop package. Missing remote configuration fails closed and must never start localhost services. Keep the preview label until pristine-Windows and real read-only Facebook acceptance. See docs/MYBOT-DESKTOP.th.md.
