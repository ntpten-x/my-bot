import { expect, it } from "vitest";
import { sourceRunEfficiency } from "../../src/lib/source-efficiency";

const base = { runs: 5, errorRuns: 0, hitLimitRuns: 0, found: 10, fresh: 5, inserted: 5, stalls: 1, durationMs: 100_000 };

it("flags sources that repeatedly hit limits without producing fresh posts", () => {
  const result = sourceRunEfficiency({ ...base, hitLimitRuns: 5, fresh: 1 });
  expect(result).toMatchObject({ level: "warn", freshPerRun: 0.2, hitLimitRate: 1, avgSeconds: 20 });
  expect(result.reason).toContain("limit");
});

it("keeps productive runs in the healthy range and withholds judgment for short samples", () => {
  expect(sourceRunEfficiency(base).level).toBe("ok");
  expect(sourceRunEfficiency({ ...base, runs: 2 }).level).toBe("off");
});
