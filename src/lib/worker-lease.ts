/** Independent renewal and fail-closed local fencing for long-running worker loops. */
export class WorkerLease {
  private leader = false;
  private validUntil = 0;
  private pending: Promise<boolean> | null = null;
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly deps: {
    acquire(): Promise<boolean>;
    onLost(): void;
    ttlMs: number;
    now?: () => number;
  }) {}
  private now() { return (this.deps.now ?? Date.now)(); }
  private lose() {
    const wasLeader = this.leader;
    this.leader = false; this.validUntil = 0;
    if (wasLeader) { this.stopped = true; this.deps.onLost(); }
  }
  start(intervalMs = 20_000) {
    this.timer = setInterval(() => { void this.renew(); }, intervalMs);
    this.timer.unref();
  }
  stop() { this.stopped = true; this.leader = false; if (this.timer) clearInterval(this.timer); }
  active() {
    if (this.leader && this.now() >= this.validUntil) this.lose();
    return !this.stopped && this.leader;
  }
  async assertActive() {
    if (!this.active()) throw new Error("Worker lease lost");
  }
  async renew(): Promise<boolean> {
    if (this.stopped) return false;
    if (this.leader && !this.active()) return false;
    if (this.pending) return this.pending;
    const started = this.now();
    this.pending = (async () => {
      try {
        const acquired = await this.deps.acquire();
        if (!acquired || this.stopped || this.now() >= started + this.deps.ttlMs - 5000) { this.lose(); return false; }
        this.validUntil = started + this.deps.ttlMs - 5000;
        this.leader = true;
        return true;
      } catch { this.lose(); return false; }
      finally { this.pending = null; }
    })();
    return this.pending;
  }
}
