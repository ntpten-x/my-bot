import { createHash } from "node:crypto";
import type { AppSettings } from "../settings";
import { effectiveGroqModel } from "./models";
import { explainAiFailure, scrubSecrets } from "../system-status";

export type LiveTest = {
  ok: boolean;
  configured: boolean;
  latencyMs: number | null;
  model: string;
  message: string;
  hint?: string;
  testedAt: string | null;
};

const TTL_MS = 5 * 60 * 1000;
const FRESH_MIN_GAP_MS = 30 * 1000;
const cache = new Map<string, { result: LiveTest; at: number }>();

async function readError(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const data = JSON.parse(text);
    return String(data?.error?.message ?? data?.error ?? data?.message ?? "");
  } catch {
    return text.slice(0, 200);
  }
}

// One tiny real request (a few output tokens) so the page can say whether the key and model really work.
async function runOnce(name: "groq" | "gemini", settings: AppSettings): Promise<LiveTest> {
  const key = name === "groq" ? settings.groqApiKey : settings.geminiApiKey;
  const model = name === "groq" ? effectiveGroqModel(settings.groqModel) : settings.geminiModel || "gemini-2.0-flash";
  if (!key) {
    return { ok: false, configured: false, latencyMs: null, model, message: "ยังไม่ได้ใส่คีย์", hint: "ใส่คีย์ในหน้า ตั้งค่า > AI ถ้าต้องการใช้", testedAt: null };
  }
  const started = performance.now();
  try {
    const response =
      name === "groq"
        ? await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, max_tokens: 16, temperature: 0, messages: [{ role: "user", content: "ping" }] }),
            signal: AbortSignal.timeout(12000),
          })
        : await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
              method: "POST",
              headers: { "content-type": "application/json", "x-goog-api-key": key },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: "ping" }] }],
                generationConfig: { maxOutputTokens: 8, temperature: 0 },
              }),
              signal: AbortSignal.timeout(12000),
            },
          );
    const latencyMs = Math.round(performance.now() - started);
    if (response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: true, configured: true, latencyMs, model, message: `ใช้งานได้ ตอบใน ${latencyMs} ms`, testedAt: new Date().toISOString() };
    }
    const raw = scrubSecrets(await readError(response), [key]);
    const explained = explainAiFailure(response.status, raw);
    return { ok: false, configured: true, latencyMs, model, message: explained.text, hint: explained.hint, testedAt: new Date().toISOString() };
  } catch (error) {
    const raw = scrubSecrets(error instanceof Error ? error.message : String(error), [key]);
    const explained = explainAiFailure(null, raw);
    return { ok: false, configured: true, latencyMs: null, model, message: explained.text, hint: explained.hint, testedAt: new Date().toISOString() };
  }
}

export async function liveTestProvider(name: "groq" | "gemini", settings: AppSettings, fresh = false) {
  const key = name === "groq" ? settings.groqApiKey : settings.geminiApiKey;
  const keyTag = createHash("sha256").update(key).digest("hex").slice(0, 10);
  const cacheKey = `${name}:${name === "groq" ? settings.groqModel : settings.geminiModel}:${keyTag}`;
  const hit = cache.get(cacheKey);
  const maxAge = fresh ? FRESH_MIN_GAP_MS : TTL_MS;
  if (hit && Date.now() - hit.at < maxAge) return hit.result;
  const result = await runOnce(name, settings);
  cache.set(cacheKey, { result, at: Date.now() });
  return result;
}
