import { expect, it } from "vitest";
import { summarizeObservation } from "../../scripts/observe-automation.mjs";

const start = Date.parse("2026-11-09T00:00:00Z");
function sample(seconds: number) {
  return { at: new Date(start + seconds * 1000).toISOString(), since: new Date(start).toISOString(),
    collection: { runs: 3, newPosts: 8, errors: 1 }, comments: {}, stages: [],
    sources: { overdueSources: 2, maxOverdueSeconds: 90 }, ai: { pending: 0, oldestPendingSeconds: 0 },
    extension: { onlineDevices: 1, outboxBatches: 0, capture: { pendingPosts: 0 }, onlineVersions: [{ version: "synthetic", devices: 1 }] } };
}

it("does not label a single healthy snapshot as a complete observation", () => {
  const report = summarizeObservation([sample(1)]);
  expect(report.coverageComplete).toBe(false);
  expect(report.incompleteReasons).toContain("duration_short");
  expect(report.commentLatencyMeasured).toBe(false);
});

it("reports cumulative totals without summing the same runs every minute", () => {
  const report = summarizeObservation([sample(0), sample(60), sample(120)], { hours: 120 / 3600, intervalSeconds: 60 });
  expect(report.coverageComplete).toBe(true);
  expect(report.collection).toMatchObject({ runs: 3, newPosts: 8, errors: 1 });
  expect(report.max).toMatchObject({ outboxBatches: 0, pendingPosts: 0, overdueSources: 2 });
});

it("keeps absent extension evidence unknown and exposes a version mismatch", () => {
  const row = sample(1);
  row.extension = { ...row.extension, onlineDevices: 0, outboxBatches: null, capture: null };
  const report = summarizeObservation([row]);
  expect(report.max.outboxBatches).toBeNull();
  expect(report.max.pendingPosts).toBeNull();
  expect(report.noCurrentExtensionSamples).toBe(1);
  expect(report.latestOnlineVersions).toEqual([{ version: "synthetic", devices: 1 }]);
});

it("marks failed samples and long gaps incomplete even after the duration elapses", () => {
  const report = summarizeObservation([sample(0), { at: sample(60).at, error: "SAMPLE_FAILED" }, sample(86400)]);
  expect(report.coverageComplete).toBe(false);
  expect(report.incompleteReasons).toEqual(["sample_errors", "sampling_gap"]);
  expect(report.failedSamples).toBe(1);
});

it("includes failures after the last successful sample in the gap calculation", () => {
  const report = summarizeObservation([sample(0), sample(60), { at: sample(3600).at, error: "SAMPLE_FAILED" }]);
  expect(report.longestGapSeconds).toBe(3540);
  expect(report.incompleteReasons).toContain("sampling_gap");
});

it("does not claim coverage when all samples failed", () => {
  const report = summarizeObservation([{ at: sample(0).at, since: sample(0).since, error: "SAMPLE_FAILED" }]);
  expect(report.incompleteReasons).toContain("no_samples");
  expect(report.collection).toBeNull();
});

it("keeps missing lifecycle evidence unknown and measures actual closing backlogs", () => {
  expect(summarizeObservation([sample(1)]).max.closingTabs).toBeNull();
  const row = sample(1);
  row.extension.tabs = { closing: 2, idleReaders: 1 };
  expect(summarizeObservation([row]).max).toMatchObject({ closingTabs: 2, idleReaders: 1 });
});
