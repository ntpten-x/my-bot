import { prisma } from "../prisma";
import { getSettings } from "../settings";
import { enrichPosts } from "./enrich";

export async function backfillEmbeddings(limit = 20) {
  const settings = await getSettings();
  const posts = await prisma.post.findMany({
    where: { OR: [{ embeddingJson: "" }, { embeddingJson: "[]" }] },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true },
  });
  if (posts.length) await enrichPosts(posts.map((post) => post.id), [], settings);
  const remaining = await prisma.post.count({ where: { OR: [{ embeddingJson: "" }, { embeddingJson: "[]" }] } });
  const filled = await prisma.post.count({
    where: { id: { in: posts.map((post) => post.id) }, NOT: { embeddingJson: "" } },
  });
  return { tried: posts.length, filled, remaining };
}
