import { prisma } from "../prisma";
import { upsertSettings } from "../settings";
import { enrichPosts } from "./enrich";
import { getSettings } from "../settings";
import { averageVector } from "./vector";
import { ACTION_DELTA } from "./preference";
import { embeddingConfig, embeddingTextKey } from "./embedding-key";

const POSITIVE = new Set(["save", "contacted", "closed_won"]);

function readVector(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number) : null;
  } catch {
    return null;
  }
}

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
  const config = embeddingConfig(settings);
  const vector = post.embeddingConfig === config && post.embeddingKey.endsWith(`|${embeddingTextKey(post.text, config)}`) ? readVector(post.embeddingJson) : null;
  if (vector) {
    const liked = POSITIVE.has(action);
    const key = liked ? "pref_liked_centroid" : "pref_disliked_centroid";
    const countKey = liked ? "pref_liked_count" : "pref_disliked_count";
    const spaceKey = liked ? "pref_liked_space" : "pref_disliked_space";
    const space = post.embeddingKey.split("|")[0];
    const currentRow = await prisma.setting.findUnique({ where: { key } });
    const countRow = await prisma.setting.findUnique({ where: { key: countKey } });
    const storedSpace = await prisma.setting.findUnique({ where: { key: spaceKey } });
    const previous = storedSpace?.value === space ? readVector(currentRow?.value) : null;
    const next = averageVector(previous, previous ? Number(countRow?.value || 0) : 0, vector);
    await upsertSettings({ [key]: JSON.stringify(next.vector), [countKey]: String(next.count), [spaceKey]: space });
  }

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
