import type { CatNode } from "../pipeline/catalog";
import { classifyWithChain, type AiCacheStore, type ProviderIssue } from "../pipeline/classify";
import type { ClassifyInput } from "../pipeline/classify-rules";
import type { AppSettings } from "../settings";
import { selectReadyProviders, type ProviderName } from "./health";
import { geminiClassify, groqClassify, ollamaClassify } from "./providers";
import { routedClassifyAttempts } from "./provider-registry";

const callers = {
  ollama: ollamaClassify,
  gemini: geminiClassify,
  groq: groqClassify,
} as const;

async function classificationPlan(settings: AppSettings, initialize = true) {
  const order: ProviderName[] =
    settings.aiProvider === "auto"
      ? ["ollama", "gemini", "groq"]
      : settings.aiProvider === "rules"
        ? []
        : [settings.aiProvider];

  // "auto" uses the owner's provider table (/settings/ai-providers) with cooldown failover.
  // An empty table, or a fixed provider choice, keeps the original env-based chain.
  const routed = settings.aiProvider === "auto" ? await routedClassifyAttempts(settings, undefined, { initialize }) : null;
  // Explicitly disabled/cooling registry presets stay disabled. Only absent env presets
  // are appended, so adding a key later works without bypassing the owner's limits.
  const legacyOrder = routed ? order.filter(name => !routed.managedPresets.includes(name)) : order;
  const selected = await selectReadyProviders(legacyOrder, settings);
  const providers = [
    ...(routed?.providers ?? []),
    ...selected.ready.map(name => ({
      name: name as string,
      classify: (batch: ClassifyInput[], tree: CatNode[]) => callers[name](batch, tree, settings),
    })),
  ];
  return { providers, errors: [...(routed?.errors ?? []), ...selected.errors] as ProviderIssue[] };
}

export function earliestProviderRetry(errors: ProviderIssue[], now = Date.now()) {
  const times = errors.flatMap(error => error.retryAt && error.retryAt > now ? [error.retryAt] : []);
  return times.length ? Math.min(...times) : now + 60_000;
}

/** Same host reachability, owner selection and quota rules as the worker; never seeds on a read. */
export async function classifyAvailability(settings: AppSettings) {
  const plan = await classificationPlan(settings, false);
  return {
    ready: plan.providers.length,
    names: plan.providers.map(provider => provider.name),
    waiting: plan.errors.filter(error => error.deferred).map(error => ({ name: error.name, reason: error.message, retryAt: error.retryAt ? new Date(error.retryAt).toISOString() : null })),
    nextReadyAt: plan.providers.length ? null : new Date(earliestProviderRetry(plan.errors)).toISOString(),
    rulesOnly: settings.aiProvider === "rules",
  };
}

export async function classifyLeads(
  posts: ClassifyInput[],
  catalog: CatNode[],
  settings: AppSettings,
  cache?: AiCacheStore,
) {
  const { providers, errors } = await classificationPlan(settings);

  const batches: ClassifyInput[][] = [];
  for (let index = 0; index < posts.length; index += 10) batches.push(posts.slice(index, index + 10));

  const results = [];
  const providersById: Record<string, string> = {};
  const attemptedIds = new Set<string>();
  let provider = "rules";
  for (const batch of batches) {
    const outcome = await classifyWithChain({ posts: batch, catalog, providers, cache });
    results.push(...outcome.results);
    Object.assign(providersById, outcome.providersById);
    errors.push(...outcome.errors);
    for (const id of outcome.attemptedIds) attemptedIds.add(id);
    if (outcome.provider !== "rules") provider = outcome.provider;
  }
  return { provider: posts.length ? provider : "rules", providersById, results, errors, attemptedIds: [...attemptedIds], retryAt: earliestProviderRetry(errors) };
}
