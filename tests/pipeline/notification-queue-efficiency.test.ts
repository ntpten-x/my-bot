import { afterEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  updateMany: vi.fn(async () => ({ count: 0 })),
  findMany: vi.fn(async () => []),
}));
const loads = vi.hoisted(() => ({ settings: vi.fn(async () => ({})) }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { notification: { updateMany: db.updateMany, findMany: db.findMany } } }));
vi.mock("../../src/lib/settings", () => ({ getSettings: loads.settings }));
import { NOTIFICATION_STALE_RECOVERY_MS, processNotificationQueue } from "../../src/lib/notification-queue";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("does not reset stale notifications or load settings on every idle poll", async () => {
  vi.useFakeTimers();
  vi.stubEnv("MYBOT_PROCESS", "worker");
  expect(await processNotificationQueue()).toBe(0);
  expect(await processNotificationQueue()).toBe(0);
  expect(db.updateMany).toHaveBeenCalledTimes(1);
  expect(loads.settings).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(NOTIFICATION_STALE_RECOVERY_MS + 1);
  await processNotificationQueue();
  expect(db.updateMany).toHaveBeenCalledTimes(2);
});
