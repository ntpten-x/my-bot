import { createHash } from "crypto";
import { catalogVersion, type CatNode } from "./catalog";
import { normalizeText } from "./normalize";
import { ruleItem, sanitizeAiItem, type AiItem, type ClassifyInput, type LooseAiItem } from "./classify-rules";

export type ProviderAttempt = {
  name: string;
  classify: (posts: ClassifyInput[], catalog: CatNode[]) => Promise<LooseAiItem[]>;
};

export type CacheHit = { provider: string; item: Omit<AiItem, "id"> };

export type AiCacheStore = {
  get: (key: string) => Promise<CacheHit | null>;
  set: (key: string, hit: CacheHit) => Promise<void>;
};

export function aiCacheKey(text: string, catalog: CatNode[], contentHash?: string): string {
  // Include actual text even with a supplied hash (legacy rows may have stale hashes;
  // OCR can also change independently of the stored post hash).
  const basis = `${catalogVersion(catalog)}|${contentHash ?? ""}|${normalizeText(text)}`;
  return createHash("sha256").update(basis).digest("hex");
}

export async function classifyWithChain(options: {
  posts: ClassifyInput[];
  catalog: CatNode[];
  providers: ProviderAttempt[];
  cache?: AiCacheStore;
}): Promise<{ provider: string; providersById: Record<string, string>; results: AiItem[]; errors: { name: string; message: string; retryAfterMs?: number }[] }> {
  const { posts, catalog, providers, cache } = options;
  const byId = new Map<string, AiItem>();
  const fromCache = new Set<string>();
  const providersById: Record<string, string> = {};
  let pending = posts;

  if (cache) {
    const uncached: ClassifyInput[] = [];
    for (const post of posts) {
      const hit = await cache.get(aiCacheKey(post.text, catalog, post.contentHash));
      if (hit && hit.provider !== "rules") {
        byId.set(post.id, sanitizeAiItem({ ...hit.item, id: post.id }, post, catalog));
        fromCache.add(post.id);
        providersById[post.id] = hit.provider;
      } else {
        uncached.push(post);
      }
    }
    pending = uncached;
  }

  let used = fromCache.size === posts.length && posts.length > 0 ? "cache" : "rules";
  const errors: { name: string; message: string; retryAfterMs?: number }[] = [];

  for (const provider of providers) {
    if (!pending.length) break;
    try {
      const output = await provider.classify(pending, catalog);
      if (!output?.length) throw new Error("empty");
      let accepted = 0;
      for (const item of output) {
        const post = pending.find((candidate) => candidate.id === item.id);
        if (!post) continue;
        const clean = sanitizeAiItem(item, post, catalog);
        byId.set(post.id, clean);
        providersById[post.id] = provider.name;
        accepted += 1;
        if (cache && provider.name !== "rules") {
          await cache.set(aiCacheKey(post.text, catalog, post.contentHash), {
            provider: provider.name,
            item: {
              categorySlug: clean.categorySlug,
              subcategorySlug: clean.subcategorySlug,
              intent: clean.intent,
              province: clean.province,
              isAd: clean.isAd,
              suggestedReply: clean.suggestedReply,
              urgency: clean.urgency,
              hasBudget: clean.hasBudget,
              specificity: clean.specificity,
            },
          });
        }
      }
      if (accepted === 0) throw new Error("โมเดลตอบมาแต่ไม่มีรายการที่ใช้ได้");
      used = provider.name;
      pending = pending.filter((post) => !byId.has(post.id));
    } catch (error) {
      errors.push({
        name: provider.name,
        message: error instanceof Error ? error.message : "เรียกผู้ให้บริการไม่สำเร็จ",
        retryAfterMs: error && typeof error === "object" && "retryAfterMs" in error ? Number(error.retryAfterMs) || 0 : 0,
      });
    }
  }

  for (const post of posts) {
    if (!byId.has(post.id)) {
      byId.set(post.id, ruleItem(post, catalog));
      providersById[post.id] = "rules";
    }
  }

  return {
    provider: used,
    providersById,
    results: posts.map((post) => byId.get(post.id)!),
    errors,
  };
}
