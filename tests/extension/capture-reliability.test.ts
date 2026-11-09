import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const background = readFileSync("extension/background.js", "utf8");
const scrape = require(path.resolve(__dirname, "../../extension/scrape.js")) as {
  planRun(opts: {
    now?: number;
    group?: Record<string, unknown>;
    lastSweepAt?: number;
    sweepBoostUntil?: number;
    forceFastSweep?: boolean;
    audit?: boolean;
  }): { mode: string };
};

const NOW = Date.parse("2026-11-09T12:00:00+07:00");
const recent = new Date(NOW - 10 * 60_000).toISOString();

it("keeps a durable pre-outbox capture journal and fail-closed full-text overflow", () => {
  expect(background).toContain("appendCaptureJournalUnlocked");
  expect(background).toContain("promoteCaptureJournalUnlocked");
  expect(background).toContain("captureJournal");
  expect(background).toContain('problem = "overflow_review"');
  expect(background).toContain("journalPending");
  expect(background).toContain("fullTextReview");
  expect(background).not.toMatch(/fullTextBacklog: Object\.fromEntries\(entries\.slice\(0, 200\)\)/);
});

it("sweeps every 20 minutes while coverage boost is active", () => {
  const normal = scrape.planRun({
    now: NOW,
    group: { lastFetchedAt: recent, intervalMinutes: 15 },
    lastSweepAt: NOW - 25 * 60_000,
  });
  expect(normal.mode).toBe("normal");

  const boosted = scrape.planRun({
    now: NOW,
    group: { lastFetchedAt: recent, intervalMinutes: 15 },
    lastSweepAt: NOW - 25 * 60_000,
    sweepBoostUntil: NOW + 60_000,
  });
  expect(boosted.mode).toBe("sweep");
});
