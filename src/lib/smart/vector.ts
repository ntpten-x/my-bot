import { createHash } from "node:crypto";

export const NEAR_DUPLICATE = 0.95;
export const DUPLICATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const CROSS_TEXT_DUP_MIN = 12;

export function normalizedTextHash(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length) return 0;
  const length = left.length;
  if (!length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function nearestDuplicate(vector: number[], others: { id: string; vector: number[] }[], threshold = NEAR_DUPLICATE) {
  let bestId: string | null = null;
  let best = 0;
  for (const other of others) {
    const similarity = cosine(vector, other.vector);
    if (similarity > best) {
      best = similarity;
      bestId = other.id;
    }
  }
  if (bestId && best >= threshold) return { id: bestId, similarity: best };
  return null;
}

export function findNearDuplicate(input: {
  sourceId: string;
  normalizedText: string;
  vector: number[] | null;
  createdAt: number;
  others: { id: string; sourceId: string; normalizedText: string; vector: number[] | null; createdAt: number }[];
  windowMs?: number;
  threshold?: number;
}) {
  const windowMs = input.windowMs ?? DUPLICATE_WINDOW_MS;
  const threshold = input.threshold ?? NEAR_DUPLICATE;
  const ownHash = input.normalizedText ? normalizedTextHash(input.normalizedText) : "";
  for (const other of input.others) {
    if (other.id === undefined) continue;
    const otherHash = other.normalizedText ? normalizedTextHash(other.normalizedText) : "";
    const sameText = Boolean(ownHash) && ownHash === otherHash;
    if (sameText && input.normalizedText.length >= CROSS_TEXT_DUP_MIN) {
      return { id: other.id, reason: "text" as const };
    }
    if (other.sourceId !== input.sourceId) continue;
    if (Math.abs(input.createdAt - other.createdAt) > windowMs) continue;
    if (sameText) return { id: other.id, reason: "text" as const };
    if (input.vector && other.vector && cosine(input.vector, other.vector) > threshold) {
      return { id: other.id, reason: "embedding" as const };
    }
  }
  return null;
}

export function averageVector(current: number[] | null, count: number, next: number[]): { vector: number[]; count: number } {
  if (!current || count <= 0) return { vector: next.slice(), count: 1 };
  const length = Math.max(current.length, next.length);
  const vector = Array.from({ length }, (_, index) => ((current[index] ?? 0) * count + (next[index] ?? 0)) / (count + 1));
  return { vector, count: count + 1 };
}
