import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), next: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { autoCommentJob: { findFirst: mocks.next } } }));
vi.mock("../../src/lib/auto-comment/control", () => ({
  readCommentControl: mocks.read,
  mayRun: (control: { state: string }) => control.state === "running",
}));
import { browserCommentRetryAfterMs } from "../../src/lib/auto-comment/browser";

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-14T00:00:00Z"));
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ state: "running", dryRun: false, generation: "current" });
});
afterEach(() => vi.useRealTimers());

it("uses the remaining durable delay and isolates device, account and generation", async () => {
  mocks.next.mockResolvedValue({ nextAttemptAt: new Date(Date.now() + 17000) });
  expect(await browserCommentRetryAfterMs("device", "99887766")).toBe(17000);
  expect(mocks.next).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    browserDeviceId: "device", browserFbUserId: "99887766", generation: "current",
    deliveryMode: "extension", status: "browser_ready", dryRun: false,
    rule: { enabled: true, pausedReason: "", browserConsent: true },
  }), orderBy: { nextAttemptAt: "asc" } }));
});

it.each([[-1000, 1000], [0, 1000], [3600000, 60000]])("bounds wake hints for delay %i", async (delay, expected) => {
  mocks.next.mockResolvedValue({ nextAttemptAt: new Date(Date.now() + delay) });
  expect(await browserCommentRetryAfterMs("device", "99887766")).toBe(expected);
});

it("does not schedule paused, stopped or simulated work", async () => {
  for (const control of [{ state: "paused" }, { state: "stopped" }, { state: "running", dryRun: true }]) {
    mocks.read.mockResolvedValue(control);
    expect(await browserCommentRetryAfterMs("device", "99887766")).toBeNull();
  }
  expect(mocks.next).not.toHaveBeenCalled();
});

it("leaves an empty queue to periodic recovery instead of a tight retry loop", async () => {
  mocks.next.mockResolvedValue(null);
  expect(await browserCommentRetryAfterMs("device", "99887766")).toBeNull();
});
