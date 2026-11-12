import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const extensionVersion = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8')).version;

export function observationOptions(args) {
  if (args.includes('--help')) return { help: true };
  if (args.some(arg => arg !== '--once' && !/^--(?:hours|interval-seconds)=/.test(arg))) throw new Error('Unknown option');
  const number = (name, fallback, min, max) => {
    const raw = args.filter(arg => arg.startsWith(`--${name}=`));
    const value = raw.length ? Number(raw[0].split('=')[1]) : fallback;
    if (raw.length > 1 || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid --${name}`);
    return value;
  };
  return { hours: number('hours', 24, 0.001, 168), intervalSeconds: number('interval-seconds', 60, 10, 3600), once: args.includes('--once') };
}

// Constant-memory reduction shared by live and offline reporting. No post samples retained.
export function createObservationSummary(options = { hours: 24, intervalSeconds: 60 }) {
  let first = null, last = null, startedAt = null, tailAt = null, previousAt = null;
  let successfulSamples = 0, failedSamples = 0, invalidSamples = 0, outOfOrder = 0, longestGapSeconds = 0;
  let noCurrentExtensionSamples = 0, resourceSamples = 0;
  const telemetryUnknown = { capture: 0, tabs: 0, sameVersionCapture: 0, sameVersionComments: 0, stageIntervals: 0 };
  const readers = {
    overdueSources: row => row.sources?.overdueSources, overdueSeconds: row => row.sources?.maxOverdueSeconds,
    aiPending: row => row.ai?.pending, aiPendingSeconds: row => row.ai?.oldestPendingSeconds,
    processingPending: row => row.processing?.pending, processingPendingSeconds: row => row.processing?.oldestPendingSeconds,
    outboxBatches: row => row.extension?.outboxBatches, pendingPosts: row => row.extension?.capture?.pendingPosts,
    pendingPostSeconds: row => row.extension?.capture?.oldestPendingSeconds,
    closingTabs: row => row.extension?.tabs?.closing, idleReaders: row => row.extension?.tabs?.idleReaders,
    uncertainComments: row => row.commentBacklog?.uncertain ?? row.comments?.uncertain,
    commentPending: row => row.commentBacklog?.pending, commentPendingSeconds: row => row.commentBacklog?.oldestPendingSeconds,
  };
  const maxima = Object.fromEntries(Object.keys(readers).map(key => [key, null]));
  let maxRssBytes = null, maxCpuSeconds = null;
  const max = (prior, value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.max(prior ?? 0, value) : prior;
  return {
    get retainedSamples() { return first ? (last === first ? 1 : 2) : 0; },
    add(row) {
      if (!row || !Number.isFinite(Date.parse(row.at))) { invalidSamples++; return; }
      if (!startedAt && Number.isFinite(Date.parse(row.since))) startedAt = row.since;
      if (previousAt && Date.parse(row.at) < Date.parse(previousAt)) outOfOrder++;
      previousAt = row.at;
      if (!tailAt || Date.parse(row.at) > Date.parse(tailAt)) tailAt = row.at;
      if (row.error) { failedSamples++; return; }
      if (!row.collection) { invalidSamples++; return; }
      first ??= row;
      startedAt ??= first.at;
      const before = last?.at ?? startedAt;
      longestGapSeconds = Math.max(longestGapSeconds, (Date.parse(row.at) - Date.parse(before)) / 1000);
      last = row;
      successfulSamples++;
      if (!row.extension?.onlineDevices) noCurrentExtensionSamples++;
      if (!row.extension?.capture) telemetryUnknown.capture++;
      if (!row.extension?.tabs) telemetryUnknown.tabs++;
      if (row.extension?.captureVersionScope !== 'expected_version') telemetryUnknown.sameVersionCapture++;
      // Jobs/logs contain no immutable extension version. A current heartbeat is not attribution.
      telemetryUnknown.sameVersionComments++;
      if (!row.stageIntervals) telemetryUnknown.stageIntervals++;
      for (const [key, read] of Object.entries(readers)) maxima[key] = max(maxima[key], read(row));
      if (row.resources?.scope === 'observer_process') {
        resourceSamples++;
        maxRssBytes = max(maxRssBytes, row.resources.rssBytes);
        maxCpuSeconds = max(maxCpuSeconds, row.resources.cpuSeconds);
      }
    },
    result() {
      const elapsedSeconds = last && startedAt ? Math.max(0, (Date.parse(last.at) - Date.parse(startedAt)) / 1000) : 0;
      const gap = Math.max(longestGapSeconds, last && tailAt ? (Date.parse(tailAt) - Date.parse(last.at)) / 1000 : 0);
      const incompleteReasons = [];
      if (elapsedSeconds < options.hours * 3600) incompleteReasons.push('duration_short');
      if (failedSamples) incompleteReasons.push('sample_errors');
      if (gap > options.intervalSeconds * 2 + 15) incompleteReasons.push('sampling_gap');
      if (!successfulSamples) incompleteReasons.push('no_samples');
      if (invalidSamples) incompleteReasons.push('invalid_samples');
      if (outOfOrder) incompleteReasons.push('out_of_order_samples');
      return { startedAt, lastSampleAt: last?.at ?? null, expectedExtensionVersion: last?.expectedExtensionVersion ?? extensionVersion,
        requestedHours: options.hours, elapsedSeconds, successfulSamples, failedSamples, invalidSamples, longestGapSeconds: gap,
        coverageComplete: !incompleteReasons.length, incompleteReasons,
        collection: last?.collection ?? null, processing: last?.processing ?? null, comments: last?.comments ?? null,
        commentBacklog: last?.commentBacklog ?? null, stages: last?.stages ?? [], stageIntervals: last?.stageIntervals ?? null,
        stageTimingBasis: 'ingest_to_stage_cumulative', commentVersionScope: 'unknown_no_historical_version',
        max: { ...maxima }, noCurrentExtensionSamples, telemetryUnknown: { ...telemetryUnknown },
        latestOnlineVersions: last?.extension?.onlineVersions ?? [],
        commentLatencyMeasured: Boolean(last?.stages?.some(row => row.stage === 'browser_observed' && row.count > 0 && Number.isFinite(row.p50Seconds) && row.p50Seconds >= 0)),
        resources: { scope: 'observer_process', samples: resourceSamples, maxRssBytes, maxCpuSeconds,
          cpuBasis: 'cumulative_process_seconds', chrome: 'unknown', system: 'unknown' },
      };
    },
  };
}

// A completed observation is evidence coverage, never an automatic stability verdict.
export function summarizeObservation(samples, options = { hours: 24, intervalSeconds: 60 }) {
  const summary = createObservationSummary(options);
  for (const row of samples) summary.add(row);
  return summary.result();
}

export async function summarizeObservationFile(file, fallbackOptions) {
  let summary;
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { row = null; }
    summary ??= createObservationSummary(row?.observation ?? fallbackOptions);
    summary.add(row);
  }
  return (summary ?? createObservationSummary(fallbackOptions)).result();
}

// Aggregates only: never read post text, account IDs, device tokens or connection strings.
// Each sample uses a read-only transaction and a database UTC clock.
export async function collectObservation(db, since) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [collection] = await tx.$queryRaw(Prisma.sql`
      SELECT count(*)::int AS "runs", coalesce(sum("inserted"),0)::int AS "newPosts",
        count(*) FILTER (WHERE "ok" AND CASE
          WHEN "stoppedBy" IN ('cap','limit','screens','loading','stalled','yield') THEN true
          WHEN "stoppedBy" IN ('seen','old','exhausted') THEN false
          ELSE ("hitLimit" AND NOT "reachedKnown") OR ("stoppedBy" IN ('end','') AND "found"<3)
        END)::int AS "incomplete",
        count(*) FILTER (WHERE "stoppedBy" IN ('loading','stalled'))::int AS "loadingOrStalled",
        count(*) FILTER (WHERE NOT "ok")::int AS "errors"
      FROM "ScrapeRun" WHERE "createdAt">=${since.toISOString()}::timestamp AND "extVersion"=${extensionVersion}`);
    const [sources] = await tx.$queryRaw`
      SELECT count(*)::int AS "overdueSources",
        coalesce(max(extract(epoch FROM ((clock_timestamp() AT TIME ZONE 'UTC')-"nextRunAt"))),0)::float8 AS "maxOverdueSeconds"
      FROM "Source" WHERE "enabled" AND "type" IN ('facebook_group','facebook_marketplace')
        AND "nextRunAt" < (clock_timestamp() AT TIME ZONE 'UTC')`;
    const [ai] = await tx.$queryRaw`
      SELECT count(*)::int AS "pending",
        coalesce(max(extract(epoch FROM ((clock_timestamp() AT TIME ZONE 'UTC')-"createdAt"))),0)::float8 AS "oldestPendingSeconds"
      FROM "AiJob" WHERE "status" IN ('pending','running')`;
    const [processing] = await tx.$queryRaw`
      SELECT count(*)::int AS "pending",
        count(*) FILTER (WHERE "processingToken" IS NOT NULL AND "processingRetryAt">(clock_timestamp() AT TIME ZONE 'UTC'))::int AS "running",
        coalesce(max(extract(epoch FROM ((clock_timestamp() AT TIME ZONE 'UTC')-"processingQueuedAt"))),0)::float8 AS "oldestPendingSeconds"
      FROM "Post" WHERE "processingState" IN ('pending_new','pending_edit')`;
    const comments = await tx.$queryRaw(Prisma.sql`
      SELECT "status", count(*)::int AS "count" FROM "AutoCommentJob"
      WHERE "deliveryMode"='extension' AND "createdAt">=${since.toISOString()}::timestamp GROUP BY "status"`);
    const stages = await tx.$queryRaw(Prisma.sql`
      SELECT l."event" AS "stage", count(*) FILTER (WHERE (l."createdAt">=p."createdAt" AND l."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC') AND p."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC')))::int AS "count",
        count(*) FILTER (WHERE NOT (l."createdAt">=p."createdAt" AND l."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC') AND p."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC')))::int AS "invalid",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (l."createdAt"-p."createdAt"))) FILTER (WHERE (l."createdAt">=p."createdAt" AND l."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC') AND p."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC')))::float8 AS "p50Seconds",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (l."createdAt"-p."createdAt"))) FILTER (WHERE (l."createdAt">=p."createdAt" AND l."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC') AND p."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC')))::float8 AS "p95Seconds"
      FROM "AutoCommentLog" l JOIN "AutoCommentJob" j ON j."id"=l."jobId" JOIN "Post" p ON p."id"=j."postId"
      WHERE j."deliveryMode"='extension' AND l."event" IN ('browser_ready','dispatch','browser_observed')
        AND l."createdAt">=${since.toISOString()}::timestamp GROUP BY l."event"
      UNION ALL
      SELECT 'ai_done' AS "stage", count(*) FILTER (WHERE (a."updatedAt">=p."createdAt" AND a."updatedAt"<=(statement_timestamp() AT TIME ZONE 'UTC') AND p."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC')))::int AS "count",
        count(*) FILTER (WHERE NOT (a."updatedAt">=p."createdAt" AND a."updatedAt"<=(statement_timestamp() AT TIME ZONE 'UTC') AND p."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC')))::int AS "invalid",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (a."updatedAt"-p."createdAt"))) FILTER (WHERE (a."updatedAt">=p."createdAt" AND a."updatedAt"<=(statement_timestamp() AT TIME ZONE 'UTC') AND p."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC')))::float8 AS "p50Seconds",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (a."updatedAt"-p."createdAt"))) FILTER (WHERE (a."updatedAt">=p."createdAt" AND a."updatedAt"<=(statement_timestamp() AT TIME ZONE 'UTC') AND p."createdAt"<=(statement_timestamp() AT TIME ZONE 'UTC')))::float8 AS "p95Seconds"
      FROM "AiJob" a JOIN "Post" p ON p."id"=a."postId"
      WHERE a."status"='done' AND a."updatedAt">=${since.toISOString()}::timestamp`);
    // Pair timestamps within each job; never subtract percentiles from independent cohorts.
    // Missing/out-of-order pairs are counted and excluded from latency percentiles.
    const stageIntervals = await tx.$queryRaw(Prisma.sql`
      WITH events AS (
        SELECT j."id", p."createdAt" AS ingest,
          min(l."createdAt") FILTER (WHERE l."event"='browser_ready') AS ready,
          min(l."createdAt") FILTER (WHERE l."event"='dispatch') AS dispatch,
          min(l."createdAt") FILTER (WHERE l."event"='browser_observed') AS observed
        FROM "AutoCommentJob" j LEFT JOIN "Post" p ON p."id"=j."postId"
          LEFT JOIN "AutoCommentLog" l ON l."jobId"=j."id"
        WHERE j."deliveryMode"='extension' AND j."createdAt">=${since.toISOString()}::timestamp
        GROUP BY j."id", p."createdAt"
      ), milestones AS (
        SELECT e.*,
          ingest<=(statement_timestamp() AT TIME ZONE 'UTC') AS ingest_valid,
          ready<=(statement_timestamp() AT TIME ZONE 'UTC')
            AND (ingest IS NULL OR ready>=ingest) AS ready_valid,
          dispatch<=(statement_timestamp() AT TIME ZONE 'UTC')
            AND (ingest IS NULL OR dispatch>=ingest)
            AND (ready IS NULL OR dispatch>=ready) AS dispatch_valid,
          observed<=(statement_timestamp() AT TIME ZONE 'UTC')
            AND (ingest IS NULL OR observed>=ingest)
            AND (ready IS NULL OR observed>=ready)
            AND (dispatch IS NULL OR observed>=dispatch) AS observed_valid
        FROM events e
      ), pairs AS (
        SELECT pair.* FROM milestones e
          CROSS JOIN LATERAL (VALUES
            ('ingest_to_ready', e.ingest, e.ready, e.ingest_valid, e.ready_valid),
            ('ready_to_dispatch', e.ready, e.dispatch, e.ready_valid, e.dispatch_valid),
            ('dispatch_to_observed', e.dispatch, e.observed, e.dispatch_valid, e.observed_valid)
          ) AS pair(stage, start_at, end_at, start_valid, end_valid)
      )
      SELECT stage, count(*) FILTER (WHERE start_valid AND end_valid AND end_at>=start_at)::int AS count,
        count(*) FILTER (WHERE start_at IS NULL OR end_at IS NULL)::int AS missing,
        count(*) FILTER (WHERE start_at IS NOT NULL AND end_at IS NOT NULL
          AND NOT coalesce(start_valid AND end_valid AND end_at>=start_at, false))::int AS invalid,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (end_at-start_at)))
          FILTER (WHERE start_valid AND end_valid AND end_at>=start_at)::float8 AS "p50Seconds",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (end_at-start_at)))
          FILTER (WHERE start_valid AND end_valid AND end_at>=start_at)::float8 AS "p95Seconds"
      FROM pairs GROUP BY stage ORDER BY stage`);
    const [commentBacklog] = await tx.$queryRaw`
      SELECT count(*) FILTER (WHERE "status"='uncertain')::int AS uncertain,
        count(*) FILTER (WHERE "status" IN ('pending','pending_ai','browser_ready','claimed','sending'))::int AS pending,
        coalesce(max(extract(epoch FROM ((clock_timestamp() AT TIME ZONE 'UTC')-"createdAt")))
          FILTER (WHERE "status" IN ('pending','pending_ai','browser_ready','claimed','sending')),0)::float8 AS "oldestPendingSeconds"
      FROM "AutoCommentJob" WHERE "deliveryMode"='extension'`;
    const observed = stages.find(row => row.stage === 'browser_observed');
    const latency = { observedCount: observed?.count ?? 0, ingestToObservedP50Seconds: observed?.p50Seconds ?? null, ingestToObservedP95Seconds: observed?.p95Seconds ?? null };
    const heartbeat = await tx.extensionHeartbeat.aggregate({ where: { version: extensionVersion, lastSeenAt: { gte: new Date(Date.now() - 600000) } }, _sum: { outboxSize: true }, _max: { lastSeenAt: true }, _count: true });
    const onlineVersions = await tx.extensionHeartbeat.groupBy({ by: ['version'], where: { lastSeenAt: { gte: new Date(Date.now() - 600000) } }, _count: { _all: true } });
    const row = await tx.setting.findUnique({ where: { key: 'extension_capture' }, select: { value: true } });
    let capture = null, captureVersionScope = 'unknown_unversioned';
    try {
      const raw = JSON.parse(row?.value || '{}');
      const age = Date.now() - Date.parse(raw.at);
      if (heartbeat._count && age >= 0 && age < 600000) {
        captureVersionScope = raw.version === extensionVersion ? 'expected_version' : raw.version ? 'other_version' : 'unknown_unversioned';
        const count = value => Number.isFinite(value) && value >= 0 ? value : null;
        capture = { pendingPosts: count(raw.pendingPosts), parkedFeeds: count(raw.parkedFeeds),
          oldestPendingSeconds: count(raw.oldestPendingAt) && raw.oldestPendingAt <= Date.now() ? (Date.now() - raw.oldestPendingAt) / 1000 : null };
      }
    } catch { /* Missing or stale heartbeat data must remain unknown, not healthy zero. */ }
    const tabRow = await tx.setting.findUnique({ where: { key: 'extension_tab_status' }, select: { value: true } });
    let tabs = null;
    try {
      const raw = JSON.parse(tabRow?.value || '{}');
      const age = Date.now() - Date.parse(raw.at);
      const keys = ['activeReaders', 'activeComments', 'parkedReaders', 'closing', 'idleReaders', 'released'];
      if (heartbeat._count && raw.version === extensionVersion && age >= 0 && age < 600000 &&
        keys.every(key => Number.isInteger(raw[key]) && raw[key] >= 0)) tabs = Object.fromEntries(keys.map(key => [key, raw[key]]));
    } catch { /* Unknown or old-version lifecycle evidence remains null. */ }
    const windowMinutes = Math.max((Date.now() - since.getTime()) / 60000, 1 / 60);
    return { at: new Date().toISOString(), since: since.toISOString(), windowMinutes, expectedExtensionVersion: extensionVersion,
      collection: { ...collection, newPostsPerMinute: collection.newPosts / windowMinutes }, sources, ai, processing,
      comments: Object.fromEntries(comments.map(row => [row.status, row.count])), commentBacklog, latency, stages, stageIntervals,
      commentVersionScope: 'unknown_no_historical_version', collectionVersionScope: 'expected_version',
      extension: { onlineDevices: heartbeat._count, onlineVersions: onlineVersions.map(row => ({ version: row.version, devices: row._count._all })), outboxBatches: heartbeat._count ? heartbeat._sum.outboxSize ?? 0 : null, lastSeenAt: heartbeat._max.lastSeenAt, capture, captureVersionScope, tabs } };
  }, { timeout: 15000 });
}

async function main() {
  const args = process.argv.slice(2);
  const reports = args.filter(arg => arg.startsWith('--summary='));
  if (reports.length > 1 || reports.some(arg => !arg.slice('--summary='.length))) throw new Error('Invalid summary file');
  const options = observationOptions(args.filter(arg => !arg.startsWith('--summary=')));
  if (options.help) {
    console.log('Read-only automation observation: --once | --hours=24 --interval-seconds=60\nReport without a database: --summary=data/automation-observation-<timestamp>.jsonl\nWrites aggregates and a .summary.json report; never starts collection or comments.');
    return;
  }
  if (reports.length) {
    console.log(JSON.stringify(await summarizeObservationFile(reports[0].slice('--summary='.length), options), null, 2));
    return;
  }
  if (!/^postgres(?:ql)?:/.test(process.env.DATABASE_URL || '')) throw new Error('PostgreSQL DATABASE_URL required');
  const db = new PrismaClient();
  const started = new Date();
  const file = path.join('data', `automation-observation-${started.toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const summary = createObservationSummary(options);
  let stopping = false, wake;
  const stop = () => { stopping = true; wake?.(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await mkdir('data', { recursive: true });
    do {
      try {
        const cpu = process.cpuUsage();
        const sample = { ...await collectObservation(db, started), resources: { scope: 'observer_process', rssBytes: process.memoryUsage().rss, cpuSeconds: (cpu.user + cpu.system) / 1e6 }, observation: { hours: options.hours, intervalSeconds: options.intervalSeconds } };
        await appendFile(file, `${JSON.stringify(sample)}\n`, 'utf8');
        summary.add(sample);
        console.log(`Sample saved: ${file}`);
      } catch {
        // Database errors can contain credentials; record a fixed diagnostic only.
        const sample = { at: new Date().toISOString(), since: started.toISOString(), error: 'SAMPLE_FAILED', observation: { hours: options.hours, intervalSeconds: options.intervalSeconds } };
        await appendFile(file, `${JSON.stringify(sample)}\n`, 'utf8');
        summary.add(sample);
        if (options.once) process.exitCode = 1;
      }
      if (options.once || stopping || Date.now() >= started.getTime() + options.hours * 3600000) break;
      await new Promise(resolve => {
        const timer = setTimeout(resolve, Math.min(options.intervalSeconds * 1000, Math.max(0, started.getTime() + options.hours * 3600000 - Date.now())));
        wake = () => { clearTimeout(timer); resolve(); };
      });
    } while (!stopping); // Take the final sample at/after the requested deadline.
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await db.$disconnect();
    await writeFile(file.replace(/\.jsonl$/, '.summary.json'), `${JSON.stringify(summary.result(), null, 2)}\n`, 'utf8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Observation failed; check database configuration and output permissions (details hidden).'); process.exitCode = 1; });
}
