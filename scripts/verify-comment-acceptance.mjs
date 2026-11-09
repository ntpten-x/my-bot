#!/usr/bin/env node
/**
 * Read-only acceptance / soak checklist for Auto Comment (Extension delivery).
 * Does not send Facebook comments. Owner still performs the one real send after review.
 *
 * Usage:
 *   node scripts/verify-comment-acceptance.mjs
 *   node scripts/verify-comment-acceptance.mjs --base https://my-bot-e6bt.onrender.com
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "extension/manifest.json"), "utf8"));
const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const base = (baseIdx >= 0 ? args[baseIdx + 1] : process.env.PUBLIC_APP_URL || "https://my-bot-e6bt.onrender.com").replace(/\/$/, "");

const gates = {
  oneShotAcceptance: [
    "Extension version matches expected (manifest / health header)",
    "Inspect target post without clicking: account, composer, exact message, unique submit",
    "Owner-approved send once in allowlisted test group",
    "Observe author + comment_id; Stop immediately on uncertainty",
    "Confirm no second dispatch for same live post key",
  ],
  stagedSoak: [
    "24h read-only collector soak first",
    "Then several days at low volume while quotas stay owner-configured",
    "Record ingest→ready→dispatch→observed latency, not_sent, uncertain, blocked, journal age, tab cleanup",
    "journal_cleared audits include ownerOutcome before local unlock",
  ],
  mustNotChange: [
    "No Graph API on normal runtime path",
    "No auto-retry after authorize/click ambiguity",
    "No silent optional-host grant / private Facebook APIs",
    "No Dry Run in owner UI",
  ],
};

async function probe(url) {
  const response = await fetch(url, { redirect: "manual" });
  return {
    status: response.status,
    headers: {
      commit: response.headers.get("x-mybot-commit"),
      extension: response.headers.get("x-mybot-extension-version"),
    },
    body: await response.json().catch(() => null),
  };
}

const health = await probe(`${base}/api/v1/health`);
const report = {
  at: new Date().toISOString(),
  base,
  localExtension: manifest.version,
  health,
  versionMatch: health.headers.extension === manifest.version,
  gates,
  note: "Defaults for hourly/daily quotas remain owner-configurable maxima; this script does not change them.",
};
console.log(JSON.stringify(report, null, 2));
if (!health.body?.ok) process.exitCode = 1;
if (health.headers.extension && health.headers.extension !== manifest.version) {
  console.error(`WARN: production extension header ${health.headers.extension} != local ${manifest.version}`);
  process.exitCode = 2;
}
