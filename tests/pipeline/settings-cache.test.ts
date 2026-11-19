import { afterEach, beforeEach, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ findMany: vi.fn(async () => []) }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { setting: { findMany: settings.findMany } } }));

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "production");
  vi.resetModules();
  settings.findMany.mockClear();
  const module = await import("../../src/lib/settings");
  module.invalidateSettingsCache();
});

afterEach(async () => {
  const module = await import("../../src/lib/settings");
  module.invalidateSettingsCache();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("shares settings reads within the short worker cache window", async () => {
  const { getSettings, SETTINGS_CACHE_MS } = await import("../../src/lib/settings");
  await getSettings();
  await getSettings();
  expect(settings.findMany).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(SETTINGS_CACHE_MS + 1);
  await getSettings();
  expect(settings.findMany).toHaveBeenCalledTimes(2);
});

it("invalidates the cached settings immediately after an owner write", async () => {
  const { getSettings, invalidateSettingsCache } = await import("../../src/lib/settings");
  await getSettings();
  invalidateSettingsCache();
  await getSettings();
  expect(settings.findMany).toHaveBeenCalledTimes(2);
});
