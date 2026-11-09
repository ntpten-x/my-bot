import type { CatNode } from "../pipeline/catalog";
import type { ClassifyInput, LooseAiItem } from "../pipeline/classify-rules";
import type { AppSettings } from "../settings";
export const OLLAMA_CLASSIFY_TIMEOUT_MS = 60_000;
export async function ollamaClassify(_posts: ClassifyInput[], _catalog: CatNode[], _settings: AppSettings): Promise<LooseAiItem[]> { void _posts; void _catalog; void _settings;  throw new Error("AI_REMOVED"); }
export const geminiClassify = ollamaClassify;
export const groqClassify = ollamaClassify;
export async function testProvider(_name: string, _settings: AppSettings) { void _name; void _settings;  return { ok: false, message: "AI_REMOVED" }; }
