#!/usr/bin/env node
// Poll a deployed origin and confirm release headers match the expected git commit.
import { scopedHealth } from "./scoped-health.mjs";
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
    const response = await scopedHealth(origin, deadline - Date.now());
    const commit = response.commit.toLowerCase();
    last = `status=${response.status} commit=${commit || "-"}`;
    if ([401, 403, 429].includes(response.status)) { console.error(`FAIL monitoring stopped: HTTP ${response.status}`); process.exit(1); }
    if (response.ok && commit && (commit === short || want.startsWith(commit))) {
      console.log(`PASS production release ${origin} commit=${commit} version=${response.version}`);
      process.exit(0);
    }
  } catch (error) {
    last = String(error?.message || error);
    if (/scope|redirect|oversized/i.test(last)) { console.error(`FAIL monitoring stopped: ${last}`); process.exit(1); }
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
console.error(`FAIL production release verification: ${last}`);
process.exit(1);
