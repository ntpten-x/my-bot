import type { CatNode } from "../pipeline/catalog";
import { classifyWithChain, type AiCacheStore } from "../pipeline/classify";
import type { ClassifyInput } from "../pipeline/classify-rules";
import type { AppSettings } from "../settings";
import { selectReadyProviders, type ProviderName } from "./health";
import { geminiClassify, groqClassify, ollamaClassify } from "./providers";

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

  const selected = await selectReadyProviders(order, settings);
  const providers = selected.ready.map((name) => ({
    name,
    classify: (batch: ClassifyInput[], tree: CatNode[]) => callers[name](batch, tree, settings),
  }));

  const batches: ClassifyInput[][] = [];
  for (let index = 0; index < posts.length; index += 10) batches.push(posts.slice(index, index + 10));

  const results = [];
  const providersById: Record<string, string> = {};
  const errors = [...selected.errors];
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
