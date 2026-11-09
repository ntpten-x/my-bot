import type { AppSettings } from "../settings";
type EmbedSettings = Pick<AppSettings, "ollamaBaseUrl" | "geminiApiKey" | "embedModel" | "geminiEmbedModel">;
export function clearEmbeddingHealthCache() {}
export function parseOllamaEmbedding(data: unknown): number[] | null {
  if (!data || typeof data !== "object") return null;
  const row = data as { embeddings?: unknown; embedding?: unknown };
  const embeddings = row.embeddings;
  if (Array.isArray(embeddings) && embeddings.length) {
    if (Array.isArray(embeddings[0])) {
      const vector = embeddings[0].map(Number);
      return vector.length && vector.every(Number.isFinite) ? vector : null;
    }
    if (typeof embeddings[0] === "number") {
      const vector = embeddings.map(Number);
      return vector.length && vector.every(Number.isFinite) ? vector : null;
    }
  }
  if (Array.isArray(row.embedding) && row.embedding.length && typeof row.embedding[0] === "number") {
    const vector = row.embedding.map(Number);
    return vector.every(Number.isFinite) ? vector : null;
  }
  return null;
}

export function ollamaEmbedModels(requested: string, installed: string[] = []): string[] {
  const bases = [requested, "bge-m3", "nomic-embed-text"].map((item) => item.trim()).filter(Boolean);
  const names: string[] = [];
  const add = (name: string) => {
    if (name && !names.includes(name)) names.push(name);
  };
  for (const base of bases) {
    const bare = base.replace(/:latest$/, "");
    const matches = installed.filter((name) => name === bare || name === `${bare}:latest` || name.startsWith(`${bare}:`));
    for (const match of matches) add(match);
    add(bare);
    add(`${bare}:latest`);
  }
  return names;
}


export async function embedText(_text: string, _settings: EmbedSettings) { void _text; void _settings;  return { vector: null as number[] | null, provider: "none", message: "AI_REMOVED", space: "" }; }
export async function testEmbedding(_settings: EmbedSettings) { void _settings;  return { ok: false, provider: "none", dimensions: 0, message: "AI_REMOVED", baseUrl: "" }; }
