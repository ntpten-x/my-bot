// Numeric diagnostics and fixed reason codes only: never credentials, URLs or desktop content.
export const profiles = Object.freeze({
  balanced: { quality: 6, compression: 2 },
  smooth: { quality: 6, compression: 0 },
  sharp: { quality: 9, compression: 0 },
});
export class ViewerSession {
  retries = 0;
  allowed = false;
  disconnectCount = 0;
  lastReason = 'initial';
  begin(now = Date.now()) { this.startedAt = now; this.allowed = true; this.lastReason = 'connecting'; }
  connected(now = Date.now()) {
    this.lastConnectMs = Math.max(0, now - this.startedAt);
    this.lastConnectedAt = now;
    this.retries = 0;
    this.lastReason = 'connected';
  }
  disconnected(reason = 'transport', now = Date.now()) {
    this.disconnectCount++;
    this.lastDisconnectedAt = now;
    if (!['manual', 'authentication', 'cancelled'].includes(this.lastReason)) this.lastReason = reason === 'clean' ? 'clean' : 'transport';
  }
  retryDelay() {
    if (!this.allowed || this.retries >= 5) return null;
    return Math.min(30000, 3000 * 2 ** this.retries++);
  }
  manualDisconnect(reason = 'manual') { this.allowed = false; this.lastReason = reason; }
  securityFailure() { this.manualDisconnect('authentication'); }
  snapshot() {
    return { reconnectAttempts: this.retries, disconnectCount: this.disconnectCount, lastReason: this.lastReason,
      lastConnectedAt: this.lastConnectedAt ?? null, lastDisconnectedAt: this.lastDisconnectedAt ?? null, lastConnectMs: this.lastConnectMs ?? null };
  }
}
