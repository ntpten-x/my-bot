import type { AppSettings } from "../settings";
import { OLLAMA_KEEP_ALIVE, ollamaReachable, resolveOllamaBaseUrl } from "../ai/ollama-url";
import { upsertSettings } from "../settings";
import { embeddingConfig } from "./embedding-key";

type EmbedSettings = Pick<AppSettings, "ollamaBaseUrl" | "geminiApiKey" | "embedModel" | "geminiEmbedModel">;

const health = new Map<string, { ok: boolean; at: number; message: string }>();
const BAD_TTL_MS = 20_000;
export function clearEmbeddingHealthCache() { health.clear(); }

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

async function remember(ok: boolean, message: string) {
  const previous = health.get("status");
  health.set("status", { ok, at: Date.now(), message });
  if (previous && previous.message === message && Date.now() - previous.at < 30_000) return;
  await upsertSettings({
    embed_last_ok: ok ? "true" : "false",
    embed_last_message: message.slice(0, 300),
    embed_last_at: new Date().toISOString(),
  }).catch(() => undefined);
}

async function installedModels(base: string): Promise<string[]> {
  try {
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.models ?? []).map((model: { name?: string }) => model.name ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

async function requestVector(base: string, model: string, text: string): Promise<number[] | null | undefined> {
  const attempts = [
    { path: "/api/embed", body: { model, input: text, keep_alive: OLLAMA_KEEP_ALIVE } },
    { path: "/api/embeddings", body: { model, prompt: text, keep_alive: OLLAMA_KEEP_ALIVE } },
  ];
  let last = "";
  for (const attempt of attempts) {
    try {
      const response = await fetch(`${base}${attempt.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attempt.body),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) return undefined;
        last = `${attempt.path} ${model} HTTP ${response.status}`;
        continue;
      }
      const vector = parseOllamaEmbedding(await response.json());
      if (vector) return vector;
      last = `${attempt.path} ${model} returned no vector`;
    } catch (error) {
      last = error instanceof Error ? error.message : "embed failed";
      return undefined;
    }
  }
  if (last) console.error("[embed]", last);
  return null;
}

async function ollamaEmbed(text: string, settings: EmbedSettings): Promise<{ vector: number[]; space: string } | null> {
  const healthKey = `ollama-embed:${embeddingConfig(settings)}`;
  const failed = health.get(healthKey);
  if (failed && !failed.ok && Date.now() - failed.at < BAD_TTL_MS) return null;
  if (!(await ollamaReachable(settings.ollamaBaseUrl))) {
    health.set(healthKey, { ok: false, at: Date.now(), message: "เซิร์ฟเวอร์นี้ไม่มี Ollama" });
    return null;
  }
  const base = await resolveOllamaBaseUrl(settings.ollamaBaseUrl);
  const installed = await installedModels(base);
  const models = ollamaEmbedModels(settings.embedModel || "bge-m3", installed);
  let last = `ไม่พบเวกเตอร์จาก ${base}`;
  for (const model of models) {
    const vector = await requestVector(base, model, text.slice(0, 2000));
    if (vector === undefined) { last = "บริการ embedding ไม่พร้อมหรือหมดเวลา"; break; }
    if (vector) {
      health.set(healthKey, { ok: true, at: Date.now(), message: `${base} ${model} (${vector.length})` });
      await remember(true, `Ollama embedding พร้อม ${model} ที่ ${base} ขนาด ${vector.length}`);
      return { vector, space: `ollama:${base}:${model.replace(/:latest$/, "")}` };
    }
    last = `เรียก embedding ไม่สำเร็จที่ ${base} โมเดล ${model}`;
  }
  health.set(healthKey, { ok: false, at: Date.now(), message: last });
  await remember(false, last);
  return null;
}

async function geminiEmbed(text: string, settings: EmbedSettings): Promise<number[] | null> {
  if (!settings.geminiApiKey) return null;
  const failed = health.get("gemini-embed");
  if (failed && !failed.ok && Date.now() - failed.at < BAD_TTL_MS) return null;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiEmbedModel}:embedContent?key=${encodeURIComponent(settings.geminiApiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 2000) }] } }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) {
      const message = `Gemini embedding HTTP ${response.status}`;
      health.set("gemini-embed", { ok: false, at: Date.now(), message });
      await remember(false, message);
      return null;
    }
    const data = await response.json();
    const vector = Array.isArray(data.embedding?.values) ? data.embedding.values.map(Number) : null;
    if (!vector?.length || !vector.every(Number.isFinite)) return null;
    health.set("gemini-embed", { ok: true, at: Date.now(), message: `gemini ${vector.length}` });
    await remember(true, `Gemini embedding ขนาด ${vector.length}`);
    return vector;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini embedding ไม่สำเร็จ";
    health.set("gemini-embed", { ok: false, at: Date.now(), message });
    await remember(false, message);
    return null;
  }
}

export async function embedText(text: string, settings: EmbedSettings): Promise<{ vector: number[] | null; provider: string; message: string; space: string }> {
  const local = await ollamaEmbed(text, settings);
  if (local) return { vector: local.vector, space: local.space, provider: "ollama", message: health.get(`ollama-embed:${embeddingConfig(settings)}`)?.message ?? "ollama" };
  const remote = await geminiEmbed(text, settings);
  if (remote) return { vector: remote, space: `gemini:${settings.geminiEmbedModel}`, provider: "gemini", message: health.get("gemini-embed")?.message ?? "gemini" };
  const message = health.get(`ollama-embed:${embeddingConfig(settings)}`)?.message || health.get("gemini-embed")?.message || "ไม่มีโมเดลฝังข้อความ";
  return { vector: null, provider: "none", message, space: "" };
}

export async function testEmbedding(settings: EmbedSettings) {
  clearEmbeddingHealthCache();
  const result = await embedText("ทดสอบภาษาไทย bge", settings);
  return {
    ok: Boolean(result.vector),
    provider: result.provider,
    dimensions: result.vector?.length ?? 0,
    message: result.message,
    baseUrl: await resolveOllamaBaseUrl(settings.ollamaBaseUrl),
  };
}
