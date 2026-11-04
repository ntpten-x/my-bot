// Provider router: try providers in priority order, cool down the ones that fail with a
// limit, quota, auth, server, or timeout error, and bring them back when the cooldown ends.
// Pure logic with an injectable store so failover is testable without a network or database.

export type RouterProvider = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  tasks: string[];
  limitPerMinute: number | null;
  limitPerDay: number | null;
  resetHourUtc: number;
  cooldownUntil: Date | null;
  requestsToday: number;
  usageDay: string | null;
};

export type FailureKind = "rate" | "quota" | "auth" | "server" | "timeout" | "bad-request" | "other";
export type Failure = { kind: FailureKind; cooldownMs: number; message: string };

/** Error thrown by provider callers. `hint` is a short keyword scan of the body, never the body itself. */
export class AiCallError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly retryAfterMs = 0,
    readonly hint: "quota" | "" = "",
  ) {
    super(message);
    this.name = "AiCallError";
  }
}

export const COOLDOWN = {
  rateDefaultMs: 60_000,
  serverMs: 60_000,
  timeoutMs: 30_000,
  authMs: 6 * 3600_000,
};

const QUOTA_WORDS = /quota|insufficient|credit|billing|exceeded your|per[- ]day|daily|RESOURCE_EXHAUSTED|out of tokens|limit reached for today/i;

export function bodyHint(body: string): "quota" | "" {
  return QUOTA_WORDS.test(body) ? "quota" : "";
}

/** Day bucket that resets at `resetHourUtc` (0 = midnight UTC, 7 = midnight Pacific in winter-ish, 17 = 00:00 Bangkok). */
export function dayKey(now: Date, resetHourUtc = 0): string {
  return new Date(now.getTime() - resetHourUtc * 3600_000).toISOString().slice(0, 10);
}

export function nextReset(now: Date, resetHourUtc = 0): Date {
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), resetHourUtc));
  if (reset.getTime() <= now.getTime()) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset;
}

export function classifyFailure(error: unknown, now: Date, resetHourUtc = 0): Failure {
  const untilReset = nextReset(now, resetHourUtc).getTime() - now.getTime();
  const name = error instanceof Error ? error.name : "";
  const raw = error instanceof Error ? error.message : String(error);
  if (error instanceof AiCallError) {
    const { status, retryAfterMs, hint } = error;
    if (status === 402 || (hint === "quota" && (status === 429 || status === 403 || status === 400))) {
      return { kind: "quota", cooldownMs: untilReset, message: `HTTP ${status} โควตา/เครดิตหมด รอรอบรีเซ็ต` };
    }
    if (status === 429) {
      return { kind: "rate", cooldownMs: retryAfterMs > 0 ? retryAfterMs : COOLDOWN.rateDefaultMs, message: "HTTP 429 ถูกจำกัดความถี่" };
    }
    if (status === 401 || status === 403) return { kind: "auth", cooldownMs: COOLDOWN.authMs, message: `HTTP ${status} คีย์ไม่ถูกต้องหรือไม่มีสิทธิ์` };
    if (status >= 500) return { kind: "server", cooldownMs: retryAfterMs > 0 ? retryAfterMs : COOLDOWN.serverMs, message: `HTTP ${status} ฝั่งผู้ให้บริการขัดข้อง` };
    if (status === 408) return { kind: "timeout", cooldownMs: COOLDOWN.timeoutMs, message: "HTTP 408 หมดเวลา" };
    if (status >= 400) return { kind: "bad-request", cooldownMs: 0, message: `HTTP ${status} คำขอไม่ถูกต้อง (ตรวจชื่อโมเดล/URL)` };
  }
  if (name === "TimeoutError" || name === "AbortError" || /timed? ?out|timeout/i.test(raw)) {
    return { kind: "timeout", cooldownMs: COOLDOWN.timeoutMs, message: "หมดเวลารอคำตอบ" };
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|network/i.test(raw)) {
    return { kind: "server", cooldownMs: COOLDOWN.timeoutMs, message: "เชื่อมต่อผู้ให้บริการไม่ได้" };
  }
  // Unknown errors (bad JSON, empty answer) skip to the next provider without a cooldown.
  return { kind: "other", cooldownMs: 0, message: raw.slice(0, 160) || "ผิดพลาด" };
}

/** Sliding one-minute window per provider, kept in memory. */
export class MinuteWindow {
  private hits = new Map<string, number[]>();
  count(id: string, now: Date) {
    const since = now.getTime() - 60_000;
    const list = (this.hits.get(id) ?? []).filter((at) => at > since);
    this.hits.set(id, list);
    return list.length;
  }
  add(id: string, now: Date) {
    this.count(id, now);
    this.hits.get(id)!.push(now.getTime());
  }
  clear() {
    this.hits.clear();
  }
}

export const sharedMinuteWindow = new MinuteWindow();

export type Unavailable = { id: string; name: string; reason: string };

export function availability(provider: RouterProvider, task: string, now: Date, minute: MinuteWindow): string | null {
  if (!provider.enabled) return "ปิดอยู่";
  if (!provider.tasks.includes(task)) return `ไม่ได้เปิดให้ทำงาน ${task}`;
  if (provider.cooldownUntil && provider.cooldownUntil.getTime() > now.getTime()) {
    return `พักถึง ${provider.cooldownUntil.toISOString()}`;
  }
  if (provider.limitPerDay && provider.usageDay === dayKey(now, provider.resetHourUtc) && provider.requestsToday >= provider.limitPerDay) {
    return `ครบโควตาวันนี้ ${provider.limitPerDay} ครั้ง`;
  }
  if (provider.limitPerMinute && minute.count(provider.id, now) >= provider.limitPerMinute) {
    return `ครบ ${provider.limitPerMinute} ครั้ง/นาที`;
  }
  return null;
}

export function orderAvailable<T extends RouterProvider>(providers: T[], task: string, now: Date, minute: MinuteWindow) {
  const ready: T[] = [];
  const skipped: Unavailable[] = [];
  for (const provider of [...providers].sort((a, b) => a.priority - b.priority)) {
    const reason = availability(provider, task, now, minute);
    if (reason) {
      if (provider.enabled && provider.tasks.includes(task)) skipped.push({ id: provider.id, name: provider.name, reason });
    } else ready.push(provider);
  }
  return { ready, skipped };
}

export interface RouterStore {
  recordSuccess(id: string, usage: { latencyMs: number; tokens: number; now: Date; day: string }): Promise<void>;
  recordFailure(id: string, failure: Failure & { now: Date; day: string; cooldownUntil: Date | null }): Promise<void>;
}

export type RouterDeps = { store: RouterStore; now?: () => Date; minute?: MinuteWindow };

/**
 * Run one call on one provider with limits and bookkeeping. Throws on failure (after the
 * cooldown is recorded) so a surrounding chain moves on to the next provider.
 */
export async function guardedCall<T>(
  provider: RouterProvider,
  task: string,
  deps: RouterDeps,
  fn: () => Promise<{ value: T; tokens?: number }>,
): Promise<T> {
  const clock = deps.now ?? (() => new Date());
  const minute = deps.minute ?? sharedMinuteWindow;
  const start = clock();
  const reason = availability(provider, task, start, minute);
  if (reason) throw new AiCallError(`${provider.name}: ${reason}`);
  const day = dayKey(start, provider.resetHourUtc);
  if (provider.usageDay !== day) {
    provider.usageDay = day;
    provider.requestsToday = 0;
  }
  provider.requestsToday += 1;
  minute.add(provider.id, start);
  try {
    const { value, tokens } = await fn();
    const end = clock();
    provider.cooldownUntil = null;
    await deps.store.recordSuccess(provider.id, { latencyMs: end.getTime() - start.getTime(), tokens: tokens ?? 0, now: end, day });
    return value;
  } catch (error) {
    const end = clock();
    const failure = classifyFailure(error, end, provider.resetHourUtc);
    const cooldownUntil = failure.cooldownMs > 0 ? new Date(end.getTime() + failure.cooldownMs) : null;
    if (cooldownUntil) provider.cooldownUntil = cooldownUntil;
    await deps.store.recordFailure(provider.id, { ...failure, now: end, day, cooldownUntil }).catch(() => undefined);
    throw new AiCallError(`${provider.name}: ${failure.message}`, error instanceof AiCallError ? error.status : 0);
  }
}

/** Try every available provider in order; null means all failed and the caller should use rules. */
export async function routeTask<P extends RouterProvider, T>(
  providers: P[],
  task: string,
  deps: RouterDeps,
  call: (provider: P) => Promise<{ value: T; tokens?: number }>,
): Promise<{ value: T; providerId: string } | { value: null; providerId: null; errors: string[] }> {
  const now = (deps.now ?? (() => new Date()))();
  const { ready, skipped } = orderAvailable(providers, task, now, deps.minute ?? sharedMinuteWindow);
  const errors = skipped.map((item) => `${item.name}: ${item.reason}`);
  for (const provider of ready) {
    try {
      const value = await guardedCall(provider, task, deps, () => call(provider));
      return { value, providerId: provider.id };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { value: null, providerId: null, errors };
}