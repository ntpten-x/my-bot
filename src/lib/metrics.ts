// Bounded samples per web process. No post text, queries, or credentials are stored.
const metricsGlobal = globalThis as typeof globalThis & { mybotTimings?: Map<string, number[]> };
const samples = metricsGlobal.mybotTimings ??= new Map<string, number[]>();
export function percentiles(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]) : null;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95) };
}
export function recordTiming(name: "ingest" | "ingest_prepare" | "ingest_store" | "ingest_enrich" | "ingest_notify" | "search" | "comment_scan" | "comment_prepare" | "comment_scan_transaction" | "comment_scan_lock" | "comment_scan_rules" | "capture_to_ingest", ms: number) {
  const rows = samples.get(name) ?? [];
  rows.push(Math.max(0, ms));
  if (rows.length > 200) rows.shift();
  samples.set(name, rows);
}
export function requestMetrics() {
  return Object.fromEntries([...samples].map(([key, rows]) => [key, percentiles(rows)]));
}
