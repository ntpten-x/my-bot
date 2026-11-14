import { expect, it } from "vitest";
import { acquireLoginSlot } from "../../src/lib/auth-capacity";
it("bounds concurrent password verification and releases capacity idempotently", () => {
  const slots = Array.from({ length: 4 }, () => acquireLoginSlot());
  try {
    expect(slots.every(Boolean)).toBe(true);
    expect(acquireLoginSlot()).toBeNull();
    slots[0]!(); slots[0]!();
    const replacement = acquireLoginSlot(); expect(replacement).not.toBeNull();
    expect(acquireLoginSlot()).toBeNull(); replacement!();
  } finally { slots.forEach(release => release?.()); }
  const available = acquireLoginSlot(); expect(available).not.toBeNull(); available!();
});
