import type { CatNode } from "../pipeline/catalog";
import { classifyWithChain, type AiCacheStore, type ProviderIssue } from "../pipeline/classify";
import type { ClassifyInput } from "../pipeline/classify-rules";
import type { AppSettings } from "../settings";

// Compatibility for old scripts; model routing and cached model output are retired.
export function earliestProviderRetry(errors: ProviderIssue[], now = Date.now()) {
  const times = errors.flatMap(error => error.retryAt && error.retryAt > now ? [error.retryAt] : []);
  return times.length ? Math.min(...times) : now + 60_000;
}
export async function classifyAvailability(_settings: AppSettings) { void _settings;
  return { ready: 1, names: ["rules"], waiting: [] as { name: string; reason: string; retryAt: string | null }[], nextReadyAt: null, rulesOnly: true };
}
export async function classifyLeads(posts: ClassifyInput[], catalog: CatNode[], _settings: AppSettings, _cache?: AiCacheStore) { void _settings; void _cache;
  const result = await classifyWithChain({ posts, catalog, providers: [] });
  return { ...result, retryAt: earliestProviderRetry([]) };
}
