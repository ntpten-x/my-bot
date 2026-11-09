import { prisma } from "../prisma";
import type { AppSettings } from "../settings";
import type { AiItem } from "../pipeline/classify-rules";
import { preferenceScore } from "./preference";
import { ruleSignals, scoreLead } from "./score";
import { CROSS_TEXT_DUP_MIN, findNearDuplicate } from "./vector";
import { captureText, chooseKeeper, mergePermalinks, readUrlList, PREFIX_DUP_MIN } from "../pipeline/capture";

export async function enrichPosts(postIds: string[], classified: AiItem[], settings: AppSettings, options: { embed?: boolean; revisions?: Map<string, number> } = {}) {
  if (!postIds.length) return;
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds }, ...(options.revisions ? { OR: postIds.map(id => ({ id, textRevision: options.revisions!.get(id) })) } : {}) },
    include: { source: true, category: true },
  });
  const weights = await prisma.preferenceWeight.findMany();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const sourceIds = [...new Set(posts.map((post) => post.sourceId))];
  const recent = await prisma.post.findMany({
    where: { duplicateOfId: null, createdAt: { gte: since }, id: { notIn: postIds }, sourceId: { in: sourceIds } },
    select: { id: true, sourceId: true, normalizedText: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 400,
  });
  const texts = [...new Set(posts.map((post) => post.normalizedText).filter((text) => text.length >= CROSS_TEXT_DUP_MIN))];
  const twins = texts.length
    ? await prisma.post.findMany({
        where: { normalizedText: { in: texts }, id: { notIn: postIds } },
        select: { id: true, sourceId: true, normalizedText: true, createdAt: true },
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
    vector: null as number[] | null,
    space: "",
    createdAt: row.createdAt.getTime(),
  }));

  for (const post of posts) {
    const item = classified.find((row) => row.id === post.id);
    const vector = null;
    const space = "";
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
      {
        category: post.category?.slug,
        keywords,
        sourceId: post.sourceId,
        author: post.authorName,
        boundCategorySlug: post.source.boundCategorySlug || "",
      },
      vector,
      null,
      null,
    );
    const signals = item
      ? { urgency: item.urgency, hasBudget: item.hasBudget, specificity: item.specificity }
      : ruleSignals(post.text);
    const bound = (post.source.boundCategorySlug || "").trim();
    const categorySlug = post.category?.slug || "";
    const offNiche = Boolean(bound && categorySlug && categorySlug !== bound && categorySlug !== "other");
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
      sourceEnabled: post.source.enabled,
      offNiche,
    });
    await prisma.post.updateMany({
      where: { id: post.id, textRevision: post.textRevision },
      data: {
        score: scored.score,
        scoreReason: scored.reason,
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

// Compatibility for old callers; the public search uses exact keywords only.
export async function semanticRank(_query: string, _settings: AppSettings, _posts: { id: string; embeddingJson: string; embeddingKey: string; embeddingConfig: string }[]) { void _query; void _settings; void _posts;
  return { warning: "ค้นด้วยคำสำคัญ", scores: new Map<string, number>() };
}
