// Login rate limiting with lockout. Pure decision logic + a Postgres-backed store (survives restarts).
export type GuardState = { failures: number; windowStart: Date; lockedUntil: Date | null };

export const LOGIN_POLICY = {
  windowMs: 15 * 60 * 1000,
  perIpFailures: 5,
  perIpLockMs: 15 * 60 * 1000,
  globalFailures: 20,
  globalLockMs: 15 * 60 * 1000,
};

export function lockedFor(state: GuardState | null, now: Date): number {
  if (!state?.lockedUntil) return 0;
  return Math.max(0, state.lockedUntil.getTime() - now.getTime());
}

export function afterFailure(state: GuardState | null, now: Date, limit: number, lockMs: number): GuardState {
  const fresh = !state || now.getTime() - state.windowStart.getTime() > LOGIN_POLICY.windowMs;
  const failures = (fresh ? 0 : state!.failures) + 1;
  const windowStart = fresh ? now : state!.windowStart;
  const lockedUntil = failures >= limit ? new Date(now.getTime() + lockMs) : state?.lockedUntil ?? null;
  return { failures: failures >= limit ? 0 : failures, windowStart: failures >= limit ? now : windowStart, lockedUntil };
}

export interface GuardStore {
  get(key: string): Promise<GuardState | null>;
  set(key: string, state: GuardState): Promise<void>;
  clear(key: string): Promise<void>;
  atomic?(work: (store: GuardStore) => Promise<void>): Promise<void>;
}

export function ipKey(ip: string) {
  return `ip:${ip}`.slice(0, 120);
}
export const GLOBAL_KEY = "global";

/** Returns ms to wait (0 = allowed). */
export async function checkLogin(store: GuardStore, ip: string, now = new Date()) {
  const [ipState, global] = await Promise.all([store.get(ipKey(ip)), store.get(GLOBAL_KEY)]);
  return Math.max(lockedFor(ipState, now), lockedFor(global, now));
}

export async function recordLogin(store: GuardStore, ip: string, ok: boolean, now = new Date()): Promise<void> {
  if (store.atomic) return store.atomic(scoped => recordLogin(scoped, ip, ok, now));
  if (ok) {
    await store.clear(ipKey(ip));
    return;
  }
  const [ipState, global] = await Promise.all([store.get(ipKey(ip)), store.get(GLOBAL_KEY)]);
  await Promise.all([
    store.set(ipKey(ip), afterFailure(ipState, now, LOGIN_POLICY.perIpFailures, LOGIN_POLICY.perIpLockMs)),
    store.set(GLOBAL_KEY, afterFailure(global, now, LOGIN_POLICY.globalFailures, LOGIN_POLICY.globalLockMs)),
  ]);
}

export function memoryGuardStore(): GuardStore {
  const map = new Map<string, GuardState>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, state) => void map.set(key, state),
    clear: async (key) => void map.delete(key),
  };
}
