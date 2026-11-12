import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { summarizeObservation } from "../../scripts/observe-automation.mjs";

const start = Date.parse("2026-11-09T00:00:00Z");
it("measures rules-only processing backlog independently of retired AI work", () => {
  expect(summarizeObservation([sample(1)]).max.processingPending).toBeNull();
  const report = summarizeObservation([
    { ...sample(1), processing: { pending: 8, running: 2, oldestPendingSeconds: 900 } },
    { ...sample(60), processing: { pending: 0, running: 0, oldestPendingSeconds: 0 } },
  ]);
  expect(report.max).toMatchObject({ aiPending: 0, processingPending: 8, processingPendingSeconds: 900 });
  expect(report.processing).toMatchObject({ pending: 0 });
});
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

it("streams days of samples with fixed retained state and identical offline results", async () => {
  const { createObservationSummary } = await import("../../scripts/observe-automation.mjs");
  const options = { hours: 72, intervalSeconds: 60 };
  const rows = Array.from({ length: 4321 }, (_, i) => sample(i * 60));
  const accumulator = createObservationSummary(options);
  for (const row of rows) accumulator.add(row);
  expect(accumulator.retainedSamples).toBeLessThanOrEqual(2);
  expect(accumulator.result()).toEqual(summarizeObservation(rows, options));
  expect(accumulator.result().successfulSamples).toBe(4321);
});

it("marks malformed, out-of-order and stale telemetry as incomplete or unknown", () => {
  const rows = [sample(0), { ...sample(60), extension: { onlineDevices: 0, capture: null, tabs: null } }, sample(30), { at: "invalid" }];
  const report = summarizeObservation(rows);
  expect(report.invalidSamples).toBe(1);
  expect(report.incompleteReasons).toContain("out_of_order_samples");
  expect(report.telemetryUnknown).toMatchObject({ capture: 1, tabs: 3, sameVersionComments: 3 });
});

it("reports stage cumulative totals and explicit paired intervals without subtracting unrelated percentiles", () => {
  const row = { ...sample(60), stages: [{ stage: "dispatch", count: 4, p50Seconds: 40 }, { stage: "browser_observed", count: 1, p50Seconds: 5 }],
    stageIntervals: [{ stage: "dispatch_to_observed", count: 0, missing: 3, invalid: 1, p50Seconds: null, p95Seconds: null }] };
  const report = summarizeObservation([row]);
  expect(report.stageIntervals).toEqual(row.stageIntervals);
  expect(report.stageTimingBasis).toBe("ingest_to_stage_cumulative");
  expect(report.commentVersionScope).toBe("unknown_no_historical_version");
  expect(report.telemetryUnknown.sameVersionComments).toBe(1);
});

it("labels resource measurements as observer process only and keeps missing resources unknown", () => {
  const report = summarizeObservation([{ ...sample(0), resources: { scope: "observer_process", rssBytes: 1234, cpuSeconds: 0.25 } }, sample(60)]);
  expect(report.resources).toMatchObject({ scope: "observer_process", maxRssBytes: 1234, maxCpuSeconds: 0.25, samples: 1 });
  expect(summarizeObservation([sample(0)]).resources.maxRssBytes).toBeNull();
});

it("keeps uncertain backlog and pending age maxima without summing cumulative outcomes", () => {
  const report = summarizeObservation([ { ...sample(0), comments: { uncertain: 3 }, extension: { ...sample(0).extension, capture: { pendingPosts: 4, oldestPendingSeconds: 50 } } },
    { ...sample(60), comments: { uncertain: 4 } } ]);
  expect(report.max).toMatchObject({ uncertainComments: 4, pendingPostSeconds: 50 });
  expect(report.comments).toEqual({ uncertain: 4 });
});

it("streams saved JSONL offline and flags malformed lines without discarding good samples", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { summarizeObservationFile } = await import("../../scripts/observe-automation.mjs");
  const directory = await mkdtemp(join(tmpdir(), "mybot-observer-"));
  try {
    const file = join(directory, "samples.jsonl");
    const options = { hours: 60 / 3600, intervalSeconds: 60 };
    await writeFile(file, [JSON.stringify({ ...sample(0), observation: options }), "{truncated", JSON.stringify(sample(60))].join("\n"));
    const result = await summarizeObservationFile(file);
    expect(result).toMatchObject({ successfulSamples: 2, invalidSamples: 1, requestedHours: options.hours, coverageComplete: false });
    expect(result.incompleteReasons).toEqual(["invalid_samples"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// Optional actual-Postgres execution, with PGlite installed outside this repository.
// MYBOT_TEST_PGLITE=/tmp/.../node_modules/@electric-sql/pglite
it.skipIf(!process.env.MYBOT_TEST_PGLITE)("excludes invalid milestones from every referencing interval and rejects future database timestamps", async () => {
  const require = createRequire(`${process.cwd()}/package.json`);
  const { PGlite } = require(process.env.MYBOT_TEST_PGLITE!);
  const pg = new PGlite();
  const { collectObservation } = await import("../../scripts/observe-automation.mjs");
  try {
    await pg.exec(`CREATE TABLE "Post" (id text, "createdAt" timestamp);
      CREATE TABLE "AutoCommentJob" (id text, "postId" text, "deliveryMode" text, "createdAt" timestamp);
      CREATE TABLE "AutoCommentLog" ("jobId" text, event text, "createdAt" timestamp);
      CREATE TABLE "AiJob" ("postId" text, status text, "updatedAt" timestamp);
      INSERT INTO "Post" VALUES ('post', (clock_timestamp() AT TIME ZONE 'UTC')-interval '90 seconds');
      INSERT INTO "AutoCommentJob" VALUES ('job', 'post', 'extension', (clock_timestamp() AT TIME ZONE 'UTC')-interval '89 seconds');
      INSERT INTO "AutoCommentLog" VALUES
        ('job', 'browser_ready', (SELECT "createdAt"-interval '5 seconds' FROM "Post")),
        ('job', 'dispatch', (SELECT "createdAt"+interval '10 seconds' FROM "Post")),
        ('job', 'browser_observed', (SELECT "createdAt"+interval '20 seconds' FROM "Post"));`);
    const tx = {
      $executeRaw: async () => {},
      $queryRaw: async (query: { text?: string; values?: unknown[] } | TemplateStringsArray) => {
        if ("text" in query && typeof query.text === "string" && (query.text.includes("WITH events AS") || query.text.includes('FROM "AutoCommentLog" l JOIN'))) {
          return (await pg.query(query.text, query.values)).rows;
        }
        return [{ newPosts: 0 }];
      },
      extensionHeartbeat: { aggregate: async () => ({ _count: 0, _max: {}, _sum: {} }), groupBy: async () => [] },
      setting: { findUnique: async () => null },
    };
    const db = { $transaction: async (work: (context: typeof tx) => Promise<unknown>) => work(tx) };
    const collect = () => collectObservation(db, new Date("2020-01-01T00:00:00Z"));
    const result = await collect();
    expect(result.stageIntervals.find((row: { stage: string; count: number; invalid: number; p50Seconds: number | null }) => row.stage === "ingest_to_ready")).toMatchObject({ count: 0, invalid: 1, p50Seconds: null });
    expect(result.stageIntervals.find((row: { stage: string; count: number; invalid: number; p50Seconds: number | null }) => row.stage === "ready_to_dispatch")).toMatchObject({ count: 0, invalid: 1, p50Seconds: null });
    expect(result.stageIntervals.find((row: { stage: string; count: number; invalid: number; p50Seconds: number | null }) => row.stage === "dispatch_to_observed")).toMatchObject({ count: 1, invalid: 0, p50Seconds: 10 });

    await pg.exec(`UPDATE "AutoCommentLog" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour' WHERE event='browser_observed';`);
    const future = await collect();
    expect(future.stageIntervals.find((row: { stage: string; count: number; invalid: number; p50Seconds: number | null }) => row.stage === "dispatch_to_observed")).toMatchObject({ count: 0, invalid: 1, p50Seconds: null });
    expect(future.stages.find((row: { stage: string; count: number; invalid: number; p50Seconds: number | null }) => row.stage === "browser_observed")).toMatchObject({ count: 0, invalid: 1, p50Seconds: null });

    await pg.exec(`UPDATE "Post" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour';
      UPDATE "AutoCommentLog" SET "createdAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 hours';
      INSERT INTO "AiJob" VALUES ('post','done',(clock_timestamp() AT TIME ZONE 'UTC')+interval '3 hours');`);
    const allFuture = await collect();
    expect(allFuture.stageIntervals.every((row: { stage: string; count: number; invalid: number; p50Seconds: number | null }) => row.count === 0 && row.invalid === 1 && row.p50Seconds === null)).toBe(true);
    expect(allFuture.stages.every((row: { stage: string; count: number; invalid: number; p50Seconds: number | null }) => row.count === 0 && row.invalid === 1 && row.p50Seconds === null)).toBe(true);
  } finally { await pg.close(); }
}, 30000);
