import type { CatNode } from "../pipeline/catalog";
import { classifyWithChain, type AiCacheStore } from "../pipeline/classify";
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

export async function classifyLeads(
  posts: ClassifyInput[],
  catalog: CatNode[],
  settings: AppSettings,
  cache?: AiCacheStore,
) {
  const order: ProviderName[] =
    settings.aiProvider === "auto"
      ? ["ollama", "gemini", "groq"]
      : settings.aiProvider === "rules"
        ? []
        : [settings.aiProvider];

  // "auto" uses the owner's provider table (/settings/ai-providers) with cooldown failover.
  // An empty table, or a fixed provider choice, keeps the original env-based chain.
  const routed = settings.aiProvider === "auto" ? await routedClassifyAttempts(settings) : null;
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

  const batches: ClassifyInput[][] = [];
  for (let index = 0; index < posts.length; index += 10) batches.push(posts.slice(index, index + 10));

  const results = [];
  const providersById: Record<string, string> = {};
  const errors = [...(routed?.errors ?? []), ...selected.errors];
  let provider = "rules";
  for (const batch of batches) {
    const outcome = await classifyWithChain({ posts: batch, catalog, providers, cache });
    results.push(...outcome.results);
    Object.assign(providersById, outcome.providersById);
    errors.push(...outcome.errors);
    if (outcome.provider !== "rules") provider = outcome.provider;
  }
  return { provider: posts.length ? provider : "rules", providersById, results, errors };
}
