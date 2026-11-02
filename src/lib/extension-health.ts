export const EXTENSION_SILENCE_MS = 30 * 60 * 1000;

export function sourceIsStale(
  source: { enabled: boolean; type: string; createdAt: Date; lastExtensionAt: Date | null },
  now = Date.now(),
) {
  if (!source.enabled || source.type !== "facebook_group") return false;
  if (now - source.createdAt.getTime() < EXTENSION_SILENCE_MS) return false;
  if (!source.lastExtensionAt) return true;
  return now - source.lastExtensionAt.getTime() > EXTENSION_SILENCE_MS;
}

export function heartbeatIsStale(lastSeen: Date | null, now = Date.now()) {
  if (!lastSeen) return true;
  return now - lastSeen.getTime() > EXTENSION_SILENCE_MS;
}
