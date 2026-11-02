export const NEAR_DUPLICATE = 0.92;

export function cosine(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
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

export function averageVector(current: number[] | null, count: number, next: number[]): { vector: number[]; count: number } {
  if (!current || count <= 0) return { vector: next.slice(), count: 1 };
  const length = Math.max(current.length, next.length);
  const vector = Array.from({ length }, (_, index) => ((current[index] ?? 0) * count + (next[index] ?? 0)) / (count + 1));
  return { vector, count: count + 1 };
}
