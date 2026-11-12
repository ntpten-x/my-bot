/** Small in-process cache with in-flight sharing, for dashboard reads that may be up to `ttlMs` old. */
const store = new Map<string, { until: number; value: Promise<unknown> }>();

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.until > now) return hit.value as Promise<T>;
  // Share pending work regardless of duration; start freshness when the read finishes.
  const value = load();
  const entry = { until: Infinity, value };
  store.set(key, entry);
  void value.then(
    () => { if (store.get(key) === entry) entry.until = Date.now() + ttlMs; },
    () => { if (store.get(key) === entry) store.delete(key); },
  );
  return value;
}

export function forget(key?: string) {
  if (key) store.delete(key);
  else store.clear();
}
