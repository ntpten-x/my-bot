import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const [categories, sources, keywords, provinces] = await Promise.all([
    prisma.category.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, slug: true, parentId: true, matchWords: true } }),
    prisma.source.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, type: true, url: true } }),
    prisma.keyword.findMany({ orderBy: { word: "asc" }, select: { id: true, word: true, type: true } }),
    prisma.post.groupBy({
      by: ["province"],
      where: { province: { not: null } },
    }),
  ]);
  return json({
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId,
      matchWords: category.matchWords,
    })),
    sources: sources.map((source) => ({ id: source.id, name: source.name, type: source.type, url: source.url })),
    keywords: keywords.map((keyword) => ({ id: keyword.id, word: keyword.word, type: keyword.type })),
    provinces: provinces.map((row) => row.province).filter(Boolean),
  });
}
