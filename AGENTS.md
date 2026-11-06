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

- Commit `.env.example` only. Leave `.env`, `data/*.db`, `data/*.log`, `data/backups/`, and `*.traineddata` untracked.
- The extension reads posts the owner can already see and POSTs them to this app. Per the latest owner instruction, optional browser comment delivery uses visible UI only, with per-rule consent, pinned device/account, Dry Run, quotas, durable sending and no ambiguous retries. It never calls private GraphQL, bypasses CAPTCHA/checkpoints or posts outside the configured group allowlist. See docs/BROWSER-COMMENTS.th.md.
- **Scrape scheduling (v1.4.0)** — `GET /api/v1/extension-config` (`src/lib/scrape-runs.ts`) returns enabled `facebook_group` + `facebook_marketplace` sources sorted by priority (สูง/ปกติ/ต่ำ = 3/10/30 min) with `due`, `knownKeys` (recent post keys) and the scroll settings (`scroll_screens` 0–10, `max_post_age_hours`, `max_posts_per_run` ≤40, `max_groups_per_cycle` default 5). The extension opens one inactive tab at a time, scrolls with `scrollTop` only (1.5–4 s waits, no clicks — "ดูเพิ่มเติม" text is read as-is), stops on known posts / too-old posts / cap / end, then POSTs `/api/v1/extension/scrape-result`. The server adapts `currentIntervalMinutes` (×0.6 when ≥5 new, min 2 min; ×1.5 when none, max 3× base ≤180) and stores `nextRunAt` + `lastRun*` stats shown on แหล่งข้อมูล and ภาพรวมระบบ. Pure logic: `src/lib/scrape-plan.ts` and `extension/scrape.js` (post keys must stay identical).
- **Marketplace sources** — search/category URLs (`/marketplace/...`, not `/marketplace/item/`) are canonicalized without `sortBy`; listing cards (title, price, location, image) become posts with intent `seller`. Parser fixtures in `extension/fixtures/` marked SYNTHETIC are hand-written, not captured from Facebook.
- Leave audio devices and OS sound settings alone.
- `scripts/windows/*.ps1` stay ASCII so Windows PowerShell 5.1 can parse them.
- Run `npm test` and `npm run build` before every commit. Fix failures first.
- Ask the owner for secrets. Do not invent keys, and do not put secrets in git, logs, or chat transcripts.

## Optional Auto Comment Engine

Current runtime uses Extension v1.9.0 delivery per the owner's latest instruction; see `docs/BROWSER-COMMENTS.th.md`. Graph transport below is retained only for legacy regression tests and is not invoked by normal worker ticks. Browser grants already issued may still click for up to 3 seconds after Stop; never promise immediate distributed cancellation. Do not send real Facebook comments without separate explicit approval.


Owner-enabled server-side Graph API comments live in `src/lib/auto-comment`, `/api/auto-comment`, and `/auto-comment`. Default is stopped + Dry Run. Only worker consumes jobs. Allow only verified Page-owned published posts through official API; groups/Marketplace remain unsupported drafts. Collector and assisted replies stay read-only; only the separately opted-in browser comment worker may click a verified comment submit button. Keep durable sending markers, global control locks, generation/revision fencing and unique live post keys; ambiguous sends must never auto-retry. Backup includes all four AutoComment tables and Restore must disable automation. See `docs/AUTO-COMMENT.th.md` for capability limits, safe rollout, rollback and validation. Tests must use mock Meta transport and disposable TEST_DATABASE_URL, never actual comment sends.
