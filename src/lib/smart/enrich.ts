import { prisma } from "../prisma";
import type { AppSettings } from "../settings";
import type { AiItem } from "../pipeline/classify-rules";
import { embedText } from "./embed";
import { preferenceScore } from "./preference";
import { ruleSignals, scoreLead } from "./score";
import { CROSS_TEXT_DUP_MIN, cosine, findNearDuplicate } from "./vector";
import { captureText, chooseKeeper, mergePermalinks, readUrlList, PREFIX_DUP_MIN } from "../pipeline/capture";
import { embeddingConfig, embeddingTextKey, readVector } from "./embedding-key";

async function loadCentroids() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["pref_liked_centroid", "pref_disliked_centroid", "pref_liked_space", "pref_disliked_space"] } },
  });
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    liked: readVector(map.pref_liked_centroid),
    disliked: readVector(map.pref_disliked_centroid),
    likedSpace: map.pref_liked_space,
    dislikedSpace: map.pref_disliked_space,
  };
}

export async function enrichPosts(postIds: string[], classified: AiItem[], settings: AppSettings, options: { embed?: boolean; revisions?: Map<string, number> } = {}) {
  if (!postIds.length) return;
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds }, ...(options.revisions ? { OR: postIds.map(id => ({ id, textRevision: options.revisions!.get(id) })) } : {}) },
    include: { source: true, category: true },
  });
  const config = embeddingConfig(settings);
  const weights = await prisma.preferenceWeight.findMany();
  const centroids = await loadCentroids();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const sourceIds = [...new Set(posts.map((post) => post.sourceId))];
  const recent = await prisma.post.findMany({
    where: { duplicateOfId: null, createdAt: { gte: since }, id: { notIn: postIds }, sourceId: { in: sourceIds } },
    select: { id: true, sourceId: true, normalizedText: true, embeddingJson: true, embeddingKey: true, embeddingConfig: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 400,
  });
  const texts = [...new Set(posts.map((post) => post.normalizedText).filter((text) => text.length >= CROSS_TEXT_DUP_MIN))];
  const twins = texts.length
    ? await prisma.post.findMany({
        where: { normalizedText: { in: texts }, id: { notIn: postIds } },
        select: { id: true, sourceId: true, normalizedText: true, embeddingJson: true, embeddingKey: true, embeddingConfig: true, createdAt: true },
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
    vector: row.embeddingConfig === config ? readVector(row.embeddingJson) : null,
    space: row.embeddingKey.split("|")[0],
    createdAt: row.createdAt.getTime(),
  }));

  for (const post of posts) {
    const item = classified.find((row) => row.id === post.id);
    const textKey = embeddingTextKey(post.text, config);
    const valid = post.embeddingConfig === config && post.embeddingKey.endsWith(`|${textKey}`);
    let vector = valid ? readVector(post.embeddingJson) : null;
    let space = valid ? post.embeddingKey.split("|")[0] : "";
    let embeddingUpdate = {};
    if (!vector && options.embed !== false && process.env.MYBOT_PROCESS === "worker") {
      const embedded = await embedText(post.text, settings);
      vector = embedded.vector;
      space = embedded.space;
      embeddingUpdate = vector
        ? { embeddingJson: JSON.stringify(vector), embeddingKey: `${space}|${textKey}`, embeddingConfig: config, embeddingRetryAt: new Date() }
        : { embeddingRetryAt: new Date(Date.now() + 5 * 60_000) };
    }
    const duplicate = findNearDuplicate({
      sourceId: post.sourceId,
      normalizedText: post.normalizedText,
      vector,
      createdAt: post.createdAt.getTime(),
      others: neighbors.map(row => ({ ...row, vector: row.space === space ? row.vector : null })),
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
      centroids.likedSpace === space ? centroids.liked : null,
      centroids.dislikedSpace === space ? centroids.disliked : null,
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
    await prisma.post.updateMany({
      where: { id: post.id, textRevision: post.textRevision },
      data: {
        score: scored.score,
        scoreReason: scored.reason,
        ...embeddingUpdate,
        duplicateOfId: post.duplicateOfId ?? duplicate?.id ?? null,
      },
    });
    neighbors.push({
      id: post.id,
      sourceId: post.sourceId,
      normalizedText: post.normalizedText,
      vector,
      space,
      createdAt: post.createdAt.getTime(),
    });
  }
  await collapseIdenticalTexts(posts.map((post) => post.normalizedText));
  // Capture dedupe runs in the worker's maintenance tick, not in request scoring.
}

export async function collapseIdenticalTexts(texts?: string[]) {
  const keys = [...new Set((texts ?? []).map((text) => text.trim()).filter((text) => text.length >= CROSS_TEXT_DUP_MIN))];
  if (!texts) {
    let after = "";
    let linked = 0;
    for (;;) {
      const rows = await prisma.$queryRaw<{ normalizedText: string }[]>`
        SELECT "normalizedText" FROM "Post"
        WHERE length("normalizedText") >= ${CROSS_TEXT_DUP_MIN} AND "normalizedText" > ${after}
        GROUP BY "normalizedText" HAVING COUNT(*) > 1 ORDER BY "normalizedText" LIMIT 50
      `;
      if (!rows.length) return linked;
      linked += await collapseIdenticalTexts(rows.map(row => row.normalizedText));
      after = rows[rows.length - 1].normalizedText;
    }
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

export async function collapseTruncatedCaptures(sourceId?: string) {
  const select = { id: true, sourceId: true, text: true, externalUrl: true, extraUrlsJson: true } as const;
  type Capture = { id: string; sourceId: string; text: string; externalUrl: string; extraUrlsJson: string };
  const groups = new Map<string, Capture[]>();
  let cursor: string | undefined;
  for (;;) {
    const posts = await prisma.post.findMany({
      where: { duplicateOfId: null, ...(sourceId ? { sourceId } : {}) }, select,
      orderBy: { id: "asc" }, take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!posts.length) break;
    for (const post of posts) {
      const text = captureText(post.text);
      if (text.length < PREFIX_DUP_MIN) continue;
      const key = `${post.sourceId}:${text.slice(0, PREFIX_DUP_MIN)}`;
      const list = groups.get(key) ?? [];
      list.push(post);
      groups.set(key, list);
    }
    cursor = posts[posts.length - 1].id;
  }
  let linked = 0;
  for (const list of groups.values()) {
    const pending = new Set(list.map((post) => post.id));
    const ranked = [...list].sort(
      (left, right) => captureText(right.text).length - captureText(left.text).length || left.id.localeCompare(right.id),
    );
    for (const keeper of ranked) {
      if (!pending.has(keeper.id)) continue;
      const absorbed: typeof list = [];
      for (const other of ranked) {
        if (other.id === keeper.id || !pending.has(other.id)) continue;
        if (chooseKeeper(keeper.text, other.text) !== "left") continue;
        absorbed.push(other);
      }
      if (!absorbed.length) continue;
      const extras = mergePermalinks(keeper.externalUrl, [
        readUrlList(keeper.extraUrlsJson),
        absorbed.flatMap((post) => [post.externalUrl, ...readUrlList(post.extraUrlsJson)]),
      ]);
      await prisma.post.update({
        where: { id: keeper.id },
        data: { extraUrlsJson: JSON.stringify(extras), duplicateOfId: null },
      });
      for (const post of absorbed) {
        pending.delete(post.id);
        await prisma.post.update({ where: { id: post.id }, data: { duplicateOfId: keeper.id } });
        linked += 1;
      }
    }
  }
  return linked;
}

export async function semanticRank(query: string, settings: AppSettings, posts: { id: string; embeddingJson: string; embeddingKey: string; embeddingConfig: string }[]) {
  const embedded = await embedText(query, settings);
  if (!embedded.vector) return { warning: embedded.message || "ยังไม่มีโมเดลฝังข้อความ จึงค้นด้วยคำแทน", scores: new Map<string, number>() };
  const scores = new Map<string, number>();
  const config = embeddingConfig(settings);
  for (const post of posts) {
    if (post.embeddingConfig !== config || !post.embeddingKey.startsWith(`${embedded.space}|`)) continue;
    const vector = readVector(post.embeddingJson);
    if (!vector) continue;
    scores.set(post.id, cosine(embedded.vector, vector));
  }
  return { warning: scores.size ? "" : "ยังไม่มีเวกเตอร์ที่เข้ากันได้ จึงค้นด้วยคำแทน", scores };
}
