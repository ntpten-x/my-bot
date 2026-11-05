import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Quiet = require("../../extension/quiet.js");

describe("extension quiet window", () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m);
  it("matches a same-day range", () => {
    expect(Quiet.inQuietWindow("19:00-23:00", at(20))).toBe(true);
    expect(Quiet.inQuietWindow("19:00-23:00", at(23))).toBe(false);
    expect(Quiet.inQuietWindow("19:00-23:00", at(18, 59))).toBe(false);
  });
  it("matches a range across midnight and multiple ranges", () => {
    expect(Quiet.inQuietWindow("22:00-02:00", at(1))).toBe(true);
    expect(Quiet.inQuietWindow("22:00-02:00", at(12))).toBe(false);
    expect(Quiet.inQuietWindow("08:00-09:00, 20:00-21:00", at(20, 30))).toBe(true);
  });
  it("ignores empty or invalid specs", () => {
    expect(Quiet.inQuietWindow("", at(20))).toBe(false);
    expect(Quiet.inQuietWindow("abc", at(20))).toBe(false);
  });
});
