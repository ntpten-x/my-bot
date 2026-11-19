// Bounded samples per process. No post text, SQL, queries, or credentials are stored.
export type MetricName =
  | "ingest" | "ingest_prepare" | "ingest_store" | "ingest_enrich" | "ingest_notify"
  | "search" | "comment_scan" | "comment_prepare" | "comment_scan_transaction"
  | "comment_scan_lock" | "comment_scan_rules" | "capture_to_ingest"
  | "db_query" | "worker_tick" | "worker_consumer" | "worker_posts" | "worker_comments";
export type MetricCounter =
  | "sse_opened" | "sse_closed" | "sse_active"
  | "worker_active_polls" | "worker_idle_polls";

const metricsGlobal = globalThis as typeof globalThis & {
  mybotTimings?: Map<string, number[]>;
  mybotCounters?: Record<MetricCounter, number>;
};
const samples = metricsGlobal.mybotTimings ??= new Map<string, number[]>();
const counters = metricsGlobal.mybotCounters ??= {
  sse_opened: 0, sse_closed: 0, sse_active: 0,
  worker_active_polls: 0, worker_idle_polls: 0,
};
export function percentiles(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]) : null;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95) };
}
export function recordTiming(name: MetricName, ms: number) {
  const rows = samples.get(name) ?? [];
  rows.push(Math.max(0, ms));
  if (rows.length > 200) rows.shift();
  samples.set(name, rows);
}
export function adjustCounter(name: MetricCounter, delta: number) {
  counters[name] = Math.max(0, counters[name] + delta);
}
export function requestMetrics() {
  return Object.fromEntries([...samples].map(([key, rows]) => [key, percentiles(rows)]));
}
export function runtimeMetrics() {
  return {
    at: new Date().toISOString(),
    timings: requestMetrics(),
    counters: { ...counters },
    memoryRss: process.memoryUsage().rss,
    uptimeSeconds: Math.round(process.uptime()),
  };
}
export type RuntimeMetrics = ReturnType<typeof runtimeMetrics>;
