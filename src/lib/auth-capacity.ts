// Bound bcrypt work per web process; the durable DB lockout still applies across hosts.
let active = 0;
const MAX_ACTIVE_LOGINS = 4;
export function acquireLoginSlot(): (() => void) | null {
  if (active >= MAX_ACTIVE_LOGINS) return null;
  active++;
  let released = false;
  return () => { if (!released) { released = true; active--; } };
}
