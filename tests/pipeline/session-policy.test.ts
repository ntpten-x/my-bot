import { expect, it } from "vitest";
import { sessionIsActive, sessionIsRecent } from "../../src/lib/session-policy";
it("enforces idle, absolute, credential-version and MFA boundaries", () => {
  const now = Date.now();
  const session = { expiresAt: new Date(now + 8 * 3600000), createdAt: new Date(now), lastSeenAt: new Date(now), authVersion: 1, mfaVerifiedAt: null };
  const owner = { authVersion: 1, mfaSecret: null };
  expect(sessionIsActive(session, owner, now)).toBe(true);
  expect(sessionIsActive({ ...session, lastSeenAt: new Date(now - 30 * 60000) }, owner, now)).toBe(false);
  expect(sessionIsActive({ ...session, createdAt: new Date(now - 8 * 3600000) }, owner, now)).toBe(false);
  expect(sessionIsActive(session, { ...owner, authVersion: 2 }, now)).toBe(false);
  expect(sessionIsActive(session, { ...owner, mfaSecret: "encrypted" }, now)).toBe(false);
  expect(sessionIsRecent({ authenticatedAt: new Date(now - 5 * 60000) }, now)).toBe(false);
});
