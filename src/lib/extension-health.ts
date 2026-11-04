import { isExtensionSource } from "./scrape-plan";
export const EXTENSION_SILENCE_MS = 30 * 60 * 1000;

export function sourceIsStale(
  source: { enabled: boolean; type: string; createdAt: Date; lastExtensionAt: Date | null; currentIntervalMinutes?: number | null },
  now = Date.now(),
) {
  if (!source.enabled || !isExtensionSource(source.type)) return false;
  // A backed-off source (e.g. low priority at 90 minutes) is not "silent" until it misses its own interval.
  const limit = Math.max(EXTENSION_SILENCE_MS, ((source.currentIntervalMinutes ?? 0) * 1.25 + 15) * 60_000);
  if (now - source.createdAt.getTime() < limit) return false;
  if (!source.lastExtensionAt) return true;
  return now - source.lastExtensionAt.getTime() > limit;
}

export function heartbeatIsStale(lastSeen: Date | null, now = Date.now()) {
  if (!lastSeen) return true;
  return now - lastSeen.getTime() > EXTENSION_SILENCE_MS;
}
