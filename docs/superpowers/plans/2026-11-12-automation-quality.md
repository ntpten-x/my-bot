# Automation Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make feed coverage, comment evidence, bottlenecks and long-run quality measurable without changing send authorization or collection flow.
**Architecture:** Reuse durable runtime records with bounded signed-in APIs and an on-demand workbench. No migration or additional background crawler.
**Tech Stack:** Next App Router, TypeScript, Prisma, Vitest, existing Node observer.
**Spec:** docs/superpowers/specs/2026-11-12-automation-quality-design.md

## Global Constraints
- Do not touch secrets, production data mutations, Chrome/profile, quotas, quiet defaults or uncertain-send fences.
- Do not commit/deploy. Preserve all unrelated dirty files.
- Real Facebook comments require separate explicit approval.
- No tests with production database; mock or disposable TEST_DATABASE_URL only.

## Review Focus
- Alias URLs and duplicates must not inflate sample recall.
- Missing timestamps, clock skew and failed stages must not appear successful.
- Inspection must never expose claim tokens or trigger sending.
- Low-volume/old-version telemetry must remain insufficient evidence.
- Hidden workbench must not poll; reports must be bounded and secret-free.

## Tasks
- [x] Feed sample/label audit: failing fixtures, canonical matching, bounded authenticated read-only API, downloadable UI component, tests.
- [x] Comment timeline/evidence: failing stage/authorization fixtures, bounded API, inspection component, tests preserving no-resend behavior.
- [x] Observer: failing gap/version/memory/bounded-aggregation tests, read-only reporting enhancements and offline outage/restart verification, tests.
- [x] Integration: source-value suggestions API + tests, /automation-quality workbench, navigation, docs and version only if runtime extension changed.
- [x] Independent review, fix findings, focused tests, full npm test and npm run build; short baseline only and honest long-run acceptance status.

## Verification

Full suite: 967 passed / 136 skipped, 151 files, exit 0 (optional PGlite SQL regression enabled outside repo). Production build exit 0. Targeted lint: 0 errors, existing `_now` warning. Chromium synthetic workbench, offline recovery and read-only database baseline passed. Independent reviews fixed fragment receipt parsing and invalid/future timestamp contamination. A bounded 24-hour read-only sampler was launched; no fresh Extension heartbeat was present in the initial baseline, so actual automation acceptance remains unknown until sufficient real samples/time exist.
