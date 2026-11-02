type Bucket = { tokens: number; updated: number };

const buckets = new Map<string, Bucket>();

export const PROVIDER_RATES: Record<string, { capacity: number; perMinute: number }> = {
  ollama: { capacity: 8, perMinute: 30 },
  gemini: { capacity: 5, perMinute: 12 },
  groq: { capacity: 6, perMinute: 25 },
};

export function resetTokenBuckets() {
  buckets.clear();
}

export function takeToken(name: string, now = Date.now()): { ok: boolean; retryAfterMs: number } {
  const rate = PROVIDER_RATES[name] ?? { capacity: 4, perMinute: 10 };
  const refillPerMs = rate.perMinute / 60_000;
  const current = buckets.get(name) ?? { tokens: rate.capacity, updated: now };
  const elapsed = Math.max(0, now - current.updated);
  current.tokens = Math.min(rate.capacity, current.tokens + elapsed * refillPerMs);
  current.updated = now;
  if (current.tokens >= 1) {
    current.tokens -= 1;
    buckets.set(name, current);
    return { ok: true, retryAfterMs: 0 };
  }
  buckets.set(name, current);
  return { ok: false, retryAfterMs: Math.ceil((1 - current.tokens) / refillPerMs) };
}

export function backoffMs(attempt: number, retryAfterSeconds?: number) {
  const cappedAttempt = Math.max(0, Math.min(attempt, 8));
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000 * 1.5 ** cappedAttempt, 15 * 60 * 1000);
  }
  return Math.min(5_000 * 2 ** cappedAttempt, 15 * 60 * 1000);
}

export class ProviderHttpError extends Error {
  retryAfterMs: number;

  constructor(message: string, retryAfterMs = 0) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}
