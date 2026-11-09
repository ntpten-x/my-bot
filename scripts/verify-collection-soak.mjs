#!/usr/bin/env node
/**
 * Collection soak verification helper (read-only).
 * Checks release headers / health and prints acceptance gates for a 24h owner soak.
 * Does not automate Facebook — the owner still runs the real capture window.
 *
 * Usage:
 *   node scripts/verify-collection-soak.mjs
 *   node scripts/verify-collection-soak.mjs --base https://my-bot-e6bt.onrender.com
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "extension/manifest.json"), "utf8"));
const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const base = (baseIdx >= 0 ? args[baseIdx + 1] : process.env.PUBLIC_APP_URL || "https://my-bot-e6bt.onrender.com").replace(/\/$/, "");

const gates = [
  "Capture recall ≥ ground-truth sample per enabled source",
  "Max due→start delay within adaptive interval × 4",
  "Oldest pending (journal+outbox) age < 30 minutes while online",
  "fullTextOverflow / journalRejectedItems / outboxRejectedItems stay at 0 unreconciled drops",
  "Verified-boundary (reachedKnown/exhausted/old) on majority of completed runs",
  "Survive network loss, MV3 restart, Chrome restart, login/checkpoint without silent loss",
];

async function probe(url) {
  const response = await fetch(url, { redirect: "manual" });
  const headers = {
    commit: response.headers.get("x-mybot-commit"),
    desktop: response.headers.get("x-mybot-desktop-version"),
    extension: response.headers.get("x-mybot-extension-version"),
  };
  const body = await response.json().catch(() => null);
  return { status: response.status, headers, body };
}

const health = await probe(`${base}/api/v1/health`);
const report = {
  at: new Date().toISOString(),
  base,
  localExtension: manifest.version,
  health,
  versionMatch: health.headers.extension === manifest.version,
  soakGates: gates,
  note: "Pass only after an owner-reviewed 24h read-only soak against these gates.",
};

console.log(JSON.stringify(report, null, 2));
if (!health.body?.ok) process.exitCode = 1;
if (health.headers.extension && health.headers.extension !== manifest.version) {
  console.error(`WARN: production extension header ${health.headers.extension} != local ${manifest.version} (deploy pending?)`);
  process.exitCode = 2;
}
