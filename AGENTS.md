# AGENTS.md

Source of truth for any coding agent opening this repo. The human guide is `docs/SETUP.th.md` (Thai). The in-app page is **วิธีใช้** (`/guide`).

Thai notes: the product UI, seed copy, and owner-facing docs are Thai. Reply to the owner in Thai. Keep code identifiers and PowerShell in English.

## What this is

MY-BOT is a local, single-owner lead radar. The owner logs into Facebook in Chrome. A read-only extension sends group posts to this app. The app dedupes, scores, classifies (buyer / seller / ad), and drafts a reply the owner copies by hand.

Stack: Next.js App Router, TypeScript, Tailwind, Prisma on Supabase Postgres (`DATABASE_URL` transaction pooler 6543 with `pgbouncer=true`, `DIRECT_URL` 5432 for migrations, RLS on every table), an in-process Node worker. Default web port **8001**. AI order: Ollama, then Gemini, then Groq, then rules. Only the worker consumes the AI queue (`MYBOT_PROCESS=worker`).

## Architecture

| Path | Role |
| --- | --- |
| `src/app/(app)` | Signed-in pages: dashboard, feed, pipeline, sources, parser, categories, learn, summaries, notifications, guide, settings |
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

Backup: the worker exports every table after 03:00 Asia/Bangkok once per day to `data/backups/YYYY-MM-DD.json.gz` and keeps 14 days. `npm run db:backup` makes a manual export; `npm run db:restore -- <file> --replace` restores (stop the app first). `npm run db:migrate-from-sqlite` is the one-time SQLite to Postgres copy (Node 22.5+). DB tests run in a throwaway `test_*` schema on `TEST_DATABASE_URL` or `DIRECT_URL` and skip without one. Never commit `.env`. Daily summary runs after the configured time (default 08:00) once per day. New migrations must stay Postgres and add `ENABLE ROW LEVEL SECURITY` for new tables.

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

## Hard rules

- Commit `.env.example` only. Leave `.env`, `data/*.db`, `data/*.log`, `data/backups/`, and `*.traineddata` untracked.
- The extension reads posts the owner can already see and POSTs them to this app. It does not publish, comment, or call Facebook's private GraphQL.
- Leave audio devices and OS sound settings alone.
- `scripts/windows/*.ps1` stay ASCII so Windows PowerShell 5.1 can parse them.
- Run `npm test` and `npm run build` before every commit. Fix failures first.
- Ask the owner for secrets. Do not invent keys, and do not put secrets in git, logs, or chat transcripts.
