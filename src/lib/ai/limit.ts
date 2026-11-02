const hits = new Map<string, number[]>();

export function allowProvider(name: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const recent = (hits.get(name) ?? []).filter((stamp) => now - stamp < 60_000);
  if (recent.length >= maxPerMinute) {
    hits.set(name, recent);
    return false;
  }
  recent.push(now);
  hits.set(name, recent);
  return true;
}

export function resetProviderLimits() {
  hits.clear();
}
