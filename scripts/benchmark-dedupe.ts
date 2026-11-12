// Synthetic, CPU-only benchmark. No database, network or Facebook activity.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { cosine, CROSS_TEXT_DUP_MIN, DUPLICATE_WINDOW_MS, findNearDuplicate, NEAR_DUPLICATE, normalizedTextHash } from "../src/lib/smart/vector";

type Input = Parameters<typeof findNearDuplicate>[0];

// The previous implementation, retained here only for differential measurement.
function legacyFindNearDuplicate(input: Input) {
  const ownHash = input.normalizedText ? normalizedTextHash(input.normalizedText) : "";
  for (const other of input.others) {
    if (other.id === undefined) continue;
    const otherHash = other.normalizedText ? normalizedTextHash(other.normalizedText) : "";
    const sameText = Boolean(ownHash) && ownHash === otherHash;
    if (sameText && input.normalizedText.length >= CROSS_TEXT_DUP_MIN) return { id: other.id, reason: "text" as const };
    if (other.sourceId !== input.sourceId) continue;
    if (Math.abs(input.createdAt - other.createdAt) > (input.windowMs ?? DUPLICATE_WINDOW_MS)) continue;
    if (sameText) return { id: other.id, reason: "text" as const };
    if (input.vector && other.vector && cosine(input.vector, other.vector) > (input.threshold ?? NEAR_DUPLICATE)) {
      return { id: other.id, reason: "embedding" as const };
    }
  }
  return null;
}

const now = 1_000_000_000;
const others = Array.from({ length: 400 }, (_, i) => ({
  id: `post-${i}`, sourceId: "group-a", normalizedText: `หาไอดีเกม ${i} ` + "รายละเอียดสินค้าและบริการ ".repeat(20),
  vector: null, createdAt: now,
}));
const batch: Input[] = Array.from({ length: 40 }, (_, i) => ({
  sourceId: "group-a", normalizedText: `หาไอดีเกมใหม่ ${i} ` + "รายละเอียดสินค้าและบริการ ".repeat(20),
  vector: null, createdAt: now, others,
}));
for (let i = 0; i < 500; i++) {
  const input = { ...batch[i % 40], normalizedText: i % 3 === 0 ? others[i % 400].normalizedText : i % 3 === 1 ? "" : "สั้น",
    sourceId: i % 2 ? "group-b" : "group-a", createdAt: i % 5 ? now : now + 999_999_999 };
  assert.deepEqual(findNearDuplicate(input), legacyFindNearDuplicate(input));
}

function medianMs(find: typeof findNearDuplicate) {
  for (const input of batch) find(input);
  return Array.from({ length: 9 }, () => {
    const start = performance.now();
    for (const input of batch) find(input);
    return performance.now() - start;
  }).sort((a, b) => a - b)[4];
}
const before = medianMs(legacyFindNearDuplicate);
const after = medianMs(findNearDuplicate);
console.log(JSON.stringify({ synthetic: true, postsPerBatch: 40, neighborsPerPost: 400, differentialCases: 500,
  beforeMedianMs: +before.toFixed(3), afterMedianMs: +after.toFixed(3), speedup: +(before / after).toFixed(1),
  shaCallsBefore: 16_040, shaCallsAfter: 0 }, null, 2));
