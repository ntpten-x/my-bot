import { expect, it } from "vitest";
import { classificationMetrics } from "../../src/lib/pipeline/evaluate";
import { percentiles, recordTiming, requestMetrics } from "../../src/lib/metrics";

it("reports buyer false positives/negatives and leaves undefined metrics empty", () => {
  const metrics = classificationMetrics([
    { expected: "buyer", predicted: "buyer" }, { expected: "buyer", predicted: "seller" },
    { expected: "seller", predicted: "buyer" }, { expected: "seller", predicted: "seller" },
  ]);
  expect(metrics.accuracy).toBe(0.5);
  expect(metrics.byIntent.buyer).toEqual({ tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5 });
  expect(metrics.byIntent.ad.precision).toBeNull();
  expect(percentiles([])).toEqual({ count: 0, p50: null, p95: null });
  expect(percentiles([100, 1, 2, 3, 4])).toEqual({ count: 5, p50: 3, p95: 100 });
});

it("bounds comment timing samples to the latest 200 measurements", () => {
  for (let i = 0; i < 250; i++) recordTiming("comment_scan_lock", i);
  expect(requestMetrics().comment_scan_lock).toEqual({ count: 200, p50: 149, p95: 239 });
});
