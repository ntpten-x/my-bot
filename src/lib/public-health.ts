// Public, unauthenticated health snapshot. Pure logic + small cache; no secrets or account IDs.
export type HealthStatus = "ok" | "degraded" | "down";

export type HealthDeps = {
  pingDb: () => Promise<void>;
  workerReady?: () => Promise<boolean>;
  availableAiProviders: () => Promise<number>;
  extensionLastSeen: () => Promise<Date | null>;
  version: string;
  startedAt: number;
  now?: () => number;
  dbTimeoutMs?: number;
};

export type HealthReport = {
  status: HealthStatus;
  version: string;
  uptimeSec: number;
  time: string;
  checks: {
    db: { ok: boolean; latencyMs: number | null };
    ai: { ok: boolean; availableProviders: number };
    extension: { lastSeenAgoSec: number | null };
    worker?: { ok: boolean };
  };
};

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function buildHealth(deps: HealthDeps): Promise<HealthReport> {
  const now = deps.now ?? Date.now;
  const timeout = deps.dbTimeoutMs ?? 2000;
  const started = now();
  let dbOk = false;
  let latencyMs: number | null = null;
  try {
    await withTimeout(deps.pingDb(), timeout);
    dbOk = true;
    latencyMs = Math.max(0, now() - started);
  } catch {
    dbOk = false;
  }

  let available = 0;
  let lastSeen: Date | null = null;
  if (dbOk) {
    const [ai, ext] = await Promise.allSettled([
      withTimeout(deps.availableAiProviders(), timeout),
      withTimeout(deps.extensionLastSeen(), timeout),
    ]);
    if (ai.status === "fulfilled") available = ai.value;
    if (ext.status === "fulfilled") lastSeen = ext.value;
  }

  let workerOk = true;
  if (deps.workerReady && dbOk) { try { workerOk = await withTimeout(deps.workerReady(), timeout); } catch { workerOk = false; } }
  const t = now();
  const aiOk = available > 0;
  const status: HealthStatus = !dbOk ? "down" : aiOk && workerOk ? "ok" : "degraded";
  return {
    status,
    version: deps.version,
    uptimeSec: Math.max(0, Math.floor((t - deps.startedAt) / 1000)),
    time: new Date(t).toISOString(),
    checks: {
      ...(deps.workerReady ? { worker: { ok: workerOk && dbOk } } : {}),
      db: { ok: dbOk, latencyMs },
      ai: { ok: aiOk, availableProviders: available },
      extension: { lastSeenAgoSec: lastSeen ? Math.max(0, Math.floor((t - lastSeen.getTime()) / 1000)) : null },
    },
  };
}

export function httpStatusFor(report: HealthReport) {
  return report.status === "down" ? 503 : 200;
}

export function createHealthCache(ttlMs = 7000, now: () => number = Date.now) {
  let cached: { at: number; report: HealthReport } | null = null;
  let inflight: Promise<HealthReport> | null = null;
  return async function get(build: () => Promise<HealthReport>): Promise<HealthReport> {
    if (cached && now() - cached.at < ttlMs) return cached.report;
    if (!inflight) {
      inflight = build()
        .then((report) => { cached = { at: now(), report }; return report; })
        .finally(() => { inflight = null; });
    }
    return inflight;
  };
}