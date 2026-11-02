import type { AppSettings } from "../settings";

type EmbedSettings = Pick<AppSettings, "ollamaBaseUrl" | "geminiApiKey"> & {
  embedModel: string;
  geminiEmbedModel: string;
};

const health = new Map<string, { ok: boolean; at: number }>();

function fresh(name: string, ok: boolean) {
  const hit = health.get(name);
  if (!hit) return false;
  return Date.now() - hit.at < (ok ? 5 * 60_000 : 2 * 60_000) && hit.ok === ok;
}

async function ollamaEmbed(text: string, settings: EmbedSettings): Promise<number[] | null> {
  if (fresh("ollama-embed", false)) return null;
  const models = [settings.embedModel, "bge-m3", "nomic-embed-text"].filter((value, index, list) => value && list.indexOf(value) === index);
  for (const model of models) {
    try {
      const response = await fetch(`${settings.ollamaBaseUrl}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: text.slice(0, 2000) }),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) continue;
      const data = await response.json();
      const vector = data.embeddings?.[0] ?? data.embedding;
      if (Array.isArray(vector) && vector.length) {
        health.set("ollama-embed", { ok: true, at: Date.now() });
        return vector.map(Number);
      }
    } catch {
      continue;
    }
  }
  health.set("ollama-embed", { ok: false, at: Date.now() });
  return null;
}

async function geminiEmbed(text: string, settings: EmbedSettings): Promise<number[] | null> {
  if (!settings.geminiApiKey || fresh("gemini-embed", false)) return null;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiEmbedModel}:embedContent?key=${encodeURIComponent(settings.geminiApiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 2000) }] } }),
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!response.ok) {
      health.set("gemini-embed", { ok: false, at: Date.now() });
      return null;
    }
    const data = await response.json();
    const vector = data.embedding?.values;
    if (!Array.isArray(vector) || !vector.length) return null;
    health.set("gemini-embed", { ok: true, at: Date.now() });
    return vector.map(Number);
  } catch {
    health.set("gemini-embed", { ok: false, at: Date.now() });
    return null;
  }
}

export async function embedText(text: string, settings: EmbedSettings): Promise<{ vector: number[] | null; provider: string }> {
  const local = await ollamaEmbed(text, settings);
  if (local) return { vector: local, provider: "ollama" };
  const remote = await geminiEmbed(text, settings);
  if (remote) return { vector: remote, provider: "gemini" };
  return { vector: null, provider: "none" };
}
