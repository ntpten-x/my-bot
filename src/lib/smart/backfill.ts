import { prisma } from "../prisma";
import { getSettings } from "../settings";
import { enrichPosts } from "./enrich";
import { embeddingConfig } from "./embedding-key";

export async function backfillEmbeddings(limit = 20) {
  if (process.env.MYBOT_PROCESS !== "worker") throw new Error("สร้าง embedding ได้เฉพาะ worker");
  const settings = await getSettings();
  const config = embeddingConfig(settings);
  const where = { OR: [{ embeddingJson: "" }, { embeddingJson: "[]" }, { embeddingConfig: { not: config } }] };
  const posts = await prisma.post.findMany({
    where: { ...where, embeddingRetryAt: { lte: new Date() } },
    orderBy: [{ embeddingRetryAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });
  if (posts.length) await enrichPosts(posts.map((post) => post.id), [], settings);
  const remaining = await prisma.post.count({ where });
  const filled = await prisma.post.count({
    where: { id: { in: posts.map((post) => post.id) }, embeddingConfig: config, NOT: { embeddingJson: "" } },
  });
  return { tried: posts.length, filled, remaining };
}
