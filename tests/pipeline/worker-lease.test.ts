import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerLease } from "../../src/lib/worker-lease";

afterEach(() => vi.useRealTimers());
describe("worker lease renewal and fencing", () => {
  it("renews independently while a job runs beyond the original TTL", async () => {
    vi.useFakeTimers();
    const acquire = vi.fn(async () => true);
    const onLost = vi.fn();
    const lease = new WorkerLease({ acquire, onLost, ttlMs: 150_000 });
    await lease.renew(); lease.start();
    await vi.advanceTimersByTimeAsync(400_000);
    expect(lease.active()).toBe(true);
    expect(acquire.mock.calls.length).toBeGreaterThan(10);
    expect(onLost).not.toHaveBeenCalled();
    lease.stop();
  });
  it.each(["denied", "network"])("fences a former leader on %s and cannot silently resume", async mode => {
    const acquire = vi.fn().mockResolvedValueOnce(true);
    if (mode === "denied") acquire.mockResolvedValue(false); else acquire.mockRejectedValue(new Error("unreachable"));
    const onLost = vi.fn();
    const lease = new WorkerLease({ acquire, onLost, ttlMs: 150_000 });
    await lease.renew();
    expect(await lease.renew()).toBe(false);
    await expect(lease.assertActive()).rejects.toThrow(/lease lost/);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(await lease.renew()).toBe(false);
  });
  it("refuses expired ownership after event-loop suspension and serializes concurrent renewal", async () => {
    let now = 0;
    const acquire = vi.fn(async () => true);
    const onLost = vi.fn();
    const lease = new WorkerLease({ acquire, onLost, ttlMs: 150_000, now: () => now });
    await Promise.all([lease.renew(), lease.renew(), lease.renew()]);
    expect(acquire).toHaveBeenCalledTimes(1);
    now = 150_001;
    expect(await lease.renew()).toBe(false);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});
