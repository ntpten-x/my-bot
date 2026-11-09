import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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

// A completed observation is evidence coverage, never an automatic stability verdict.
export function summarizeObservation(samples, options = { hours: 24, intervalSeconds: 60 }) {
  const valid = samples.filter(row => !row.error && row.collection && Number.isFinite(Date.parse(row.at)));
  const first = valid[0], last = valid.at(-1);
  const startedAt = samples.find(row => row.since)?.since ?? first?.at ?? null;
  const elapsedSeconds = last && startedAt ? Math.max(0, (Date.parse(last.at) - Date.parse(startedAt)) / 1000) : 0;
  let longestGapSeconds = 0;
  let previous = startedAt;
  for (const row of valid) {
    if (previous) longestGapSeconds = Math.max(longestGapSeconds, (Date.parse(row.at) - Date.parse(previous)) / 1000);
    previous = row.at;
  }
  // Include a failed tail so a long outage cannot look like complete coverage.
  if (previous && samples.at(-1)?.at) longestGapSeconds = Math.max(longestGapSeconds, (Date.parse(samples.at(-1).at) - Date.parse(previous)) / 1000);
  const maximum = read => {
    const values = valid.map(read).filter(value => typeof value === 'number' && Number.isFinite(value));
    return values.length ? Math.max(...values) : null;
  };
  const failedSamples = samples.filter(row => row.error).length;
  const incompleteReasons = [];
  if (elapsedSeconds < options.hours * 3600) incompleteReasons.push('duration_short');
  if (failedSamples) incompleteReasons.push('sample_errors');
  if (longestGapSeconds > options.intervalSeconds * 2 + 15) incompleteReasons.push('sampling_gap');
  if (!valid.length) incompleteReasons.push('no_samples');
  return { startedAt, lastSampleAt: last?.at ?? null, expectedExtensionVersion: last?.expectedExtensionVersion ?? extensionVersion,
    requestedHours: options.hours, elapsedSeconds, successfulSamples: valid.length, failedSamples, longestGapSeconds,
    coverageComplete: !incompleteReasons.length, incompleteReasons,
    collection: last?.collection ?? null, comments: last?.comments ?? null, stages: last?.stages ?? [],
    max: { overdueSources: maximum(row => row.sources?.overdueSources), overdueSeconds: maximum(row => row.sources?.maxOverdueSeconds),
      aiPending: maximum(row => row.ai?.pending), aiPendingSeconds: maximum(row => row.ai?.oldestPendingSeconds),
      outboxBatches: maximum(row => row.extension?.outboxBatches), pendingPosts: maximum(row => row.extension?.capture?.pendingPosts),
      closingTabs: maximum(row => row.extension?.tabs?.closing), idleReaders: maximum(row => row.extension?.tabs?.idleReaders) },
    noCurrentExtensionSamples: valid.filter(row => !row.extension?.onlineDevices).length,
    latestOnlineVersions: last?.extension?.onlineVersions ?? [],
    commentLatencyMeasured: Boolean(last?.stages?.some(row => row.stage === 'browser_observed' && row.count > 0)),
  };
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
    const comments = await tx.$queryRaw(Prisma.sql`
      SELECT "status", count(*)::int AS "count" FROM "AutoCommentJob"
      WHERE "deliveryMode"='extension' AND "createdAt">=${since.toISOString()}::timestamp GROUP BY "status"`);
    const stages = await tx.$queryRaw(Prisma.sql`
      SELECT l."event" AS "stage", count(*)::int AS "count",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (l."createdAt"-p."createdAt")))::float8 AS "p50Seconds",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (l."createdAt"-p."createdAt")))::float8 AS "p95Seconds"
      FROM "AutoCommentLog" l JOIN "AutoCommentJob" j ON j."id"=l."jobId" JOIN "Post" p ON p."id"=j."postId"
      WHERE j."deliveryMode"='extension' AND l."event" IN ('browser_ready','dispatch','browser_observed')
        AND l."createdAt">=${since.toISOString()}::timestamp GROUP BY l."event"
      UNION ALL
      SELECT 'ai_done' AS "stage", count(*)::int AS "count",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (a."updatedAt"-p."createdAt")))::float8 AS "p50Seconds",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (a."updatedAt"-p."createdAt")))::float8 AS "p95Seconds"
      FROM "AiJob" a JOIN "Post" p ON p."id"=a."postId"
      WHERE a."status"='done' AND a."updatedAt">=${since.toISOString()}::timestamp`);
    const observed = stages.find(row => row.stage === 'browser_observed');
    const latency = { observedCount: observed?.count ?? 0, ingestToObservedP50Seconds: observed?.p50Seconds ?? null, ingestToObservedP95Seconds: observed?.p95Seconds ?? null };
    const heartbeat = await tx.extensionHeartbeat.aggregate({ where: { version: extensionVersion, lastSeenAt: { gte: new Date(Date.now() - 600000) } }, _sum: { outboxSize: true }, _max: { lastSeenAt: true }, _count: true });
    const onlineVersions = await tx.extensionHeartbeat.groupBy({ by: ['version'], where: { lastSeenAt: { gte: new Date(Date.now() - 600000) } }, _count: { _all: true } });
    const row = await tx.setting.findUnique({ where: { key: 'extension_capture' }, select: { value: true } });
    let capture = null;
    try {
      const raw = JSON.parse(row?.value || '{}');
      const age = Date.now() - Date.parse(raw.at);
      if (heartbeat._count && age >= 0 && age < 600000) {
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
      collection: { ...collection, newPostsPerMinute: collection.newPosts / windowMinutes }, sources, ai,
      comments: Object.fromEntries(comments.map(row => [row.status, row.count])), latency, stages,
      extension: { onlineDevices: heartbeat._count, onlineVersions: onlineVersions.map(row => ({ version: row.version, devices: row._count._all })), outboxBatches: heartbeat._count ? heartbeat._sum.outboxSize ?? 0 : null, lastSeenAt: heartbeat._max.lastSeenAt, capture, tabs } };
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
    const samples = readFileSync(reports[0].slice('--summary='.length), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    console.log(JSON.stringify(summarizeObservation(samples, samples[0]?.observation ?? options), null, 2));
    return;
  }
  if (!/^postgres(?:ql)?:/.test(process.env.DATABASE_URL || '')) throw new Error('PostgreSQL DATABASE_URL required');
  const db = new PrismaClient();
  const started = new Date();
  const file = path.join('data', `automation-observation-${started.toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const samples = [];
  let stopping = false, wake;
  const stop = () => { stopping = true; wake?.(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await mkdir('data', { recursive: true });
    do {
      try {
        const sample = { ...await collectObservation(db, started), observation: { hours: options.hours, intervalSeconds: options.intervalSeconds } };
        await appendFile(file, `${JSON.stringify(sample)}\n`, 'utf8');
        samples.push(sample);
        console.log(`Sample saved: ${file}`);
      } catch {
        // Database errors can contain credentials; record a fixed diagnostic only.
        const sample = { at: new Date().toISOString(), since: started.toISOString(), error: 'SAMPLE_FAILED', observation: { hours: options.hours, intervalSeconds: options.intervalSeconds } };
        await appendFile(file, `${JSON.stringify(sample)}\n`, 'utf8');
        samples.push(sample);
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
    await writeFile(file.replace(/\.jsonl$/, '.summary.json'), `${JSON.stringify(summarizeObservation(samples, options), null, 2)}\n`, 'utf8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Observation failed; check database configuration and output permissions (details hidden).'); process.exitCode = 1; });
}
