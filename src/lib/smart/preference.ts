import { cosine } from "./vector";

export const ACTION_DELTA: Record<string, number> = {
  dismiss: -2,
  save: 1,
  contacted: 2,
  closed_won: 3,
  closed_lost: -1,
};

export function preferenceScore(
  weights: { kind: string; key: string; weight: number }[],
  post: { category?: string | null; keywords: string[]; sourceId?: string | null; author?: string | null },
  vector: number[] | null,
  likedCentroid: number[] | null,
  dislikedCentroid: number[] | null,
) {
  const hits: number[] = [];
  for (const row of weights) {
    const match =
      (row.kind === "category" && row.key === post.category) ||
      (row.kind === "keyword" && post.keywords.includes(row.key)) ||
      (row.kind === "source" && row.key === post.sourceId) ||
      (row.kind === "author" && row.key && row.key === post.author);
    if (match) hits.push(row.weight);
  }
  const weightMean = hits.length ? hits.reduce((sum, value) => sum + value, 0) / hits.length : 0;
  let semantic = 0;
  if (vector && likedCentroid) semantic += cosine(vector, likedCentroid);
  if (vector && dislikedCentroid) semantic -= cosine(vector, dislikedCentroid);
  const combined = weightMean / 3 + semantic;
  return Math.max(-1, Math.min(1, combined));
}
