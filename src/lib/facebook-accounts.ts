import { prisma } from "./prisma";
import { verifyDeviceToken } from "./extension-devices";
import { HEARTBEAT_OK_MS } from "./system-status";

export const ACCOUNT_PAUSE_PREFIX = "facebook_account_paused_";
export const validFacebookId = (id: string) => /^\d{5,20}$/.test(id);

export async function pausedFacebookIds() {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: ACCOUNT_PAUSE_PREFIX }, value: "1" }, select: { key: true } });
  return new Set(rows.map(row => row.key.slice(ACCOUNT_PAUSE_PREFIX.length)));
}

/** Heartbeats remain allowed while paused. Work requests check every reported identity, including the paired device's last heartbeat. */
export async function facebookWorkAllowed(request: Request, reportedId?: string | null) {
  const paused = await pausedFacebookIds();
  if (!paused.size) return true;
  const ids = [reportedId, request.headers.get("x-facebook-user-id")].filter((id): id is string => Boolean(id && validFacebookId(id)));
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const deviceId = await verifyDeviceToken(token);
  if (deviceId) {
    const runtime = await prisma.setting.findUnique({ where: { key: `extension_runtime_${deviceId}` }, select: { value: true } });
    try {
      const id = JSON.parse(runtime?.value || "{}").fbUserId;
      if (typeof id === "string" && validFacebookId(id)) ids.push(id);
    } catch { /* Missing identity is not permission to work while account controls are active. */ }
  }
  return ids.length > 0 && ids.every(id => !paused.has(id));
}

export function accountPresence(accountId: string, installs: { id: string; fbUserId: string | null; fbLoggedIn: boolean; enabled: boolean; lastSeenAt: Date }[], now = Date.now()) {
  const matching = installs.filter(row => row.fbUserId === accountId && row.fbLoggedIn);
  const live = matching.filter(row => now - row.lastSeenAt.getTime() <= HEARTBEAT_OK_MS);
  return { connected: live.length > 0, localEnabled: live.some(row => row.enabled), liveInstallIds: live.map(row => row.id) };
}
