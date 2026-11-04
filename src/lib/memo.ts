/** Small in-process cache with in-flight sharing, for dashboard reads that may be up to `ttlMs` old. */
const store = new Map<string, { until: number; value: Promise<unknown> }>();

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.until > now) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { until: now + ttlMs, value });
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  return value;
}

export function forget(key?: string) {
  if (key) store.delete(key);
  else store.clear();
}
