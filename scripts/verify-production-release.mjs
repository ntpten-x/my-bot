#!/usr/bin/env node
// Poll a deployed origin and confirm release headers match the expected git commit.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const origin = (process.env.PRODUCTION_ORIGIN || process.argv[2] || "").replace(/\/$/, "");
const expected = (process.env.EXPECTED_COMMIT || process.argv[3] || "").trim().toLowerCase();
if (!origin || !/^https:\/\//i.test(origin)) {
  console.error("Usage: node scripts/verify-production-release.mjs <https-origin> [commit-sha]");
  process.exit(2);
}
const want = (expected || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toLowerCase();
const short = want.slice(0, 12);
const deadline = Date.now() + Number(process.env.VERIFY_TIMEOUT_MS || 180_000);
let last = "";
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${origin}/api/v1/health?verify=${createHash("sha1").update(String(Date.now())).digest("hex").slice(0, 8)}`, {
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(15_000),
    });
    const commit = (response.headers.get("x-mybot-commit") || "").toLowerCase();
    const body = await response.json().catch(() => ({}));
    last = `status=${response.status} commit=${commit || "-"} body=${JSON.stringify(body)}`;
    if (response.ok && body?.ok === true && commit && (commit === short || want.startsWith(commit))) {
      console.log(`PASS production release ${origin} commit=${commit} version=${body.version}`);
      process.exit(0);
    }
  } catch (error) {
    last = String(error?.message || error);
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
console.error(`FAIL production release verification: ${last}`);
process.exit(1);
