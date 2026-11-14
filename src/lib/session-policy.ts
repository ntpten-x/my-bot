export const SESSION_ABSOLUTE_MS = 8 * 60 * 60_000;
export const SESSION_IDLE_MS = 30 * 60_000;
export const RECENT_AUTH_MS = 5 * 60_000;
export function sessionIsActive(session: { expiresAt: Date; createdAt: Date; lastSeenAt: Date; authVersion: number; mfaVerifiedAt: Date | null }, owner: { authVersion: number; mfaSecret: string | null }, now = Date.now()) {
  return session.expiresAt.getTime() > now && now - session.createdAt.getTime() < SESSION_ABSOLUTE_MS
    && now - session.lastSeenAt.getTime() < SESSION_IDLE_MS && session.authVersion === owner.authVersion
    && (!owner.mfaSecret || Boolean(session.mfaVerifiedAt));
}
export function sessionIsRecent(session: { authenticatedAt: Date }, now = Date.now()) {
  return now >= session.authenticatedAt.getTime() && now - session.authenticatedAt.getTime() < RECENT_AUTH_MS;
}

export function mfaRequiredForAccess() { return process.env.SECURITY_RELEASE_READY === "1" && process.env.SECURITY_REQUIRE_MFA !== "0"; }
