import { prisma } from "../prisma";
import { enrichPosts } from "./enrich";
import { getSettings } from "../settings";
import { ACTION_DELTA } from "./preference";

async function bump(kind: string, key: string, delta: number) {
  if (!key) return;
  const existing = await prisma.preferenceWeight.findUnique({ where: { kind_key: { kind, key } } });
  if (!existing) {
    await prisma.preferenceWeight.create({ data: { kind, key, weight: delta } });
    return;
  }
  await prisma.preferenceWeight.update({ where: { id: existing.id }, data: { weight: existing.weight + delta } });
}

export async function recordFeedback(postId: string, action: string) {
  const delta = ACTION_DELTA[action];
  if (delta === undefined) throw new Error("ไม่รู้จักการกระทำนี้");
  const post = await prisma.post.findUnique({ where: { id: postId }, include: { category: true } });
  if (!post) throw new Error("ไม่พบประกาศ");
  await prisma.feedback.create({ data: { postId, action } });
  let keywords: string[] = [];
  try {
    const parsed = JSON.parse(post.keywordHitsJson);
    if (Array.isArray(parsed)) keywords = parsed.map(String);
  } catch {
    keywords = [];
  }
  if (post.category?.slug) await bump("category", post.category.slug, delta);
  for (const word of keywords) await bump("keyword", word, delta);
  await bump("source", post.sourceId, delta);
  if (post.authorName) await bump("author", post.authorName, delta);

  const settings = await getSettings();
  const data: { dismissed?: boolean; isSaved?: boolean; pipelineStatus?: string } = {};
  if (action === "dismiss") data.dismissed = true;
  if (action === "save") {
    data.isSaved = true;
    data.dismissed = false;
    if (post.pipelineStatus === "none") data.pipelineStatus = "following";
  }
  if (action === "contacted") {
    data.pipelineStatus = "contacted";
    data.isSaved = true;
  }
  if (action === "closed_won") {
    data.pipelineStatus = "closed_won";
    data.isSaved = true;
  }
  if (action === "closed_lost") {
    data.pipelineStatus = "closed_lost";
    data.isSaved = true;
  }
  await prisma.post.update({ where: { id: postId }, data });
  await enrichPosts([postId], [], settings, { embed: false });
}
