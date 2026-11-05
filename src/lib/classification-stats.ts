import { prisma } from "./prisma";

const DAY = 24 * 3600_000;

export type GroupAccuracy = {
  sourceId: string;
  name: string;
  posts: number;
  reviewed: number;
  corrected: number;
  accuracy: number | null;
  ruleDecided: number;
  other7d: number;
};

/** Share of reviewed posts the owner did not have to fix. null until at least one post was reviewed. */
export function accuracyFrom(reviewed: number, corrected: number): number | null {
  if (reviewed <= 0) return null;
  return Math.max(0, Math.min(1, (reviewed - Math.min(corrected, reviewed)) / reviewed));
}

/** Per group, last 30 days: reviewed = read, saved, dismissed, replied or corrected. */
export async function classificationStats(now = Date.now()): Promise<GroupAccuracy[]> {
  const since = new Date(now - 30 * DAY);
  const week = new Date(now - 7 * DAY);
  const [sources, other] = await Promise.all([
    prisma.source.findMany({ select: { id: true, name: true } }),
    prisma.category.findFirst({ where: { slug: "other", parentId: null }, select: { id: true } }),
  ]);
  const base = { duplicateOfId: null, createdAt: { gte: since } };
  const reviewedWhere = { OR: [{ isRead: true }, { isSaved: true }, { dismissed: true }, { repliedAt: { not: null } }, { labelFixes: { some: {} } }] };
  const [posts, reviewed, corrected, ruled, other7d] = await Promise.all([
    prisma.post.groupBy({ by: ["sourceId"], where: base, _count: { _all: true } }),
    prisma.post.groupBy({ by: ["sourceId"], where: { ...base, ...reviewedWhere }, _count: { _all: true } }),
    prisma.post.groupBy({ by: ["sourceId"], where: { ...base, labelFixes: { some: {} } }, _count: { _all: true } }),
    prisma.post.groupBy({ by: ["sourceId"], where: { ...base, OR: [{ aiProvider: null }, { aiProvider: { startsWith: "rules" } }] }, _count: { _all: true } }),
    prisma.post.groupBy({
      by: ["sourceId"],
      where: { duplicateOfId: null, createdAt: { gte: week }, OR: [{ categoryId: null }, ...(other ? [{ categoryId: other.id }] : [])] },
      _count: { _all: true },
    }),
  ]);
  const count = (rows: { sourceId: string; _count: { _all: number } }[], id: string) => rows.find((row) => row.sourceId === id)?._count._all ?? 0;
  return sources
    .map((source) => {
      const r = count(reviewed, source.id);
      const c = count(corrected, source.id);
      return {
        sourceId: source.id,
        name: source.name,
        posts: count(posts, source.id),
        reviewed: r,
        corrected: c,
        accuracy: accuracyFrom(r, c),
        ruleDecided: count(ruled, source.id),
        other7d: count(other7d, source.id),
      };
    })
    .filter((row) => row.posts > 0)
    .sort((a, b) => b.posts - a.posts);
}
