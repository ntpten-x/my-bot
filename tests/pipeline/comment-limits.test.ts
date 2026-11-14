import { expect, it } from "vitest";
import { commentControlSchema } from "../../src/lib/auto-comment/schema";
import { defaultControl, parseControl } from "../../src/lib/auto-comment/control";

it("persists one-minute capacity without silently replacing saved lower owner limits", () => {
  const control = { ...defaultControl, state: "running", generation: "synthetic", startedAt: "2026-11-14T00:00:00Z", hourlyLimit: 60, dailyLimit: 1440 };
  expect(commentControlSchema.safeParse({ hourlyLimit: 60, dailyLimit: 1440 }).success).toBe(true);
  expect(parseControl(JSON.stringify(control))).toEqual(control);
  const old = { ...control, hourlyLimit: 50, dailyLimit: 200 };
  expect(parseControl(JSON.stringify(old))).toEqual(old);
});

it.each([{ hourlyLimit: 61 }, { dailyLimit: 1441 }, { hourlyLimit: 0 }, { dailyLimit: -1 }, { hourlyLimit: 1.5 }])("rejects invalid owner limits %j", input => {
  expect(commentControlSchema.safeParse(input).success).toBe(false);
  expect(parseControl(JSON.stringify({ ...defaultControl, state: "running", ...input }))).toEqual(defaultControl);
});
