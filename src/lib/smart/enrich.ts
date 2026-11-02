import { prisma } from "../prisma";
import type { AppSettings } from "../settings";
import type { AiItem } from "../pipeline/classify-rules";
import { embedText } from "./embed";
import { preferenceScore } from "./preference";
import { ruleSignals, scoreLead } from "./score";
import { CROSS_TEXT_DUP_MIN, cosine, findNearDuplicate } from "./vector";

function readVector(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number) : null;
  } catch {
    return null;
  }
}

async function loadCentroids() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["pref_liked_centroid", "pref_disliked_centroid"] } },
  });
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    liked: readVector(map.pref_liked_centroid),
    disliked: readVector(map.pref_disliked_centroid),
  };
}

export async function enrichPosts(postIds: string[], classified: AiItem[], settings: AppSettings) {
  if (!postIds.length) return;
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    include: { source: true, category: true },
  });
  const weights = await prisma.preferenceWeight.findMany();
  const centroids = await loadCentroids();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const sourceIds = [...new Set(posts.map((post) => post.sourceId))];
  const recent = await prisma.post.findMany({
    where: { createdAt: { gte: since }, id: { notIn: postIds }, sourceId: { in: sourceIds } },
    select: { id: true, sourceId: true, normalizedText: true, embeddingJson: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 400,
  });
  const texts = [...new Set(posts.map((post) => post.normalizedText).filter((text) => text.length >= CROSS_TEXT_DUP_MIN))];
  const twins = texts.length
    ? await prisma.post.findMany({
        where: { normalizedText: { in: texts }, id: { notIn: postIds } },
        select: { id: true, sourceId: true, normalizedText: true, embeddingJson: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 200,
      })
    : [];
  const neighborRows = new Map<string, (typeof recent)[number] | (typeof twins)[number]>();
  for (const row of [...twins, ...recent]) neighborRows.set(row.id, row);
  const neighbors = [...neighborRows.values()].map((row) => ({
    id: row.id,
    sourceId: row.sourceId,
    normalizedText: row.normalizedText,
    vector: readVector(row.embeddingJson),
    createdAt: row.createdAt.getTime(),
  }));

  for (const post of posts) {
    const item = classified.find((row) => row.id === post.id);
    const embedded = await embedText(post.text, settings);
    const vector = embedded.vector;
    const duplicate = findNearDuplicate({
      sourceId: post.sourceId,
      normalizedText: post.normalizedText,
      vector,
      createdAt: post.createdAt.getTime(),
      others: neighbors,
    });
    const ageHours = Math.max(0, (Date.now() - post.createdAt.getTime()) / 3600000);
    let keywords: string[] = [];
    try {
      const parsed = JSON.parse(post.keywordHitsJson);
      if (Array.isArray(parsed)) keywords = parsed.map(String);
    } catch {
      keywords = [];
    }
    const preference = preferenceScore(
      weights,
      { category: post.category?.slug, keywords, sourceId: post.sourceId, author: post.authorName },
      vector,
      centroids.liked,
      centroids.disliked,
    );
    const signals = item
      ? { urgency: item.urgency, hasBudget: item.hasBudget, specificity: item.specificity }
      : ruleSignals(post.text);
    const scored = scoreLead({
      text: post.text,
      intent: post.intent,
      isAd: post.isAd,
      forbidden: post.forbiddenHit,
      keywordHits: keywords.length,
      ageHours,
      sourceQuality: post.source.lastError ? 0.35 : 0.85,
      signals,
      preference,
    });
    await prisma.post.update({
      where: { id: post.id },
      data: {
        score: scored.score,
        scoreReason: scored.reason,
        embeddingJson: vector ? JSON.stringify(vector) : "",
        duplicateOfId: duplicate?.id ?? null,
      },
    });
    neighbors.push({
      id: post.id,
      sourceId: post.sourceId,
      normalizedText: post.normalizedText,
      vector,
      createdAt: post.createdAt.getTime(),
    });
  }
  await collapseIdenticalTexts(posts.map((post) => post.normalizedText));
}

export async function collapseIdenticalTexts(texts?: string[]) {
  let keys = [...new Set((texts ?? []).map((text) => text.trim()).filter((text) => text.length >= CROSS_TEXT_DUP_MIN))];
  if (!texts) {
    const rows = await prisma.$queryRaw<{ normalizedText: string }[]>`
      SELECT "normalizedText" as "normalizedText" FROM "Post"
      WHERE length("normalizedText") >= ${CROSS_TEXT_DUP_MIN}
      GROUP BY "normalizedText"
      HAVING COUNT(*) > 1
      LIMIT 50
    `;
    keys = rows.map((row) => row.normalizedText);
  }
  if (!keys.length) return 0;
  const found = await prisma.post.findMany({
    where: { normalizedText: { in: keys } },
    select: { id: true, normalizedText: true, createdAt: true, duplicateOfId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const groups = new Map<string, typeof found>();
  for (const post of found) {
    const list = groups.get(post.normalizedText) ?? [];
    list.push(post);
    groups.set(post.normalizedText, list);
  }
  let linked = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const canon = list[0];
    if (canon.duplicateOfId) {
      await prisma.post.update({ where: { id: canon.id }, data: { duplicateOfId: null } });
    }
    for (const post of list.slice(1)) {
      if (post.duplicateOfId === canon.id) continue;
      await prisma.post.update({ where: { id: post.id }, data: { duplicateOfId: canon.id } });
      linked += 1;
    }
  }
  return linked;
}

export async function semanticRank(query: string, settings: AppSettings, posts: { id: string; embeddingJson: string }[]) {
  const embedded = await embedText(query, settings);
  if (!embedded.vector) return { warning: embedded.message || "ยังไม่มีโมเดลฝังข้อความ จึงค้นด้วยคำแทน", scores: new Map<string, number>() };
  const scores = new Map<string, number>();
  for (const post of posts) {
    const vector = readVector(post.embeddingJson);
    if (!vector) continue;
    scores.set(post.id, cosine(embedded.vector, vector));
  }
  return { warning: "", scores };
}
