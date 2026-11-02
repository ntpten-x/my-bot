import type { AppSettings } from "../settings";
import { groqAvailability, rememberGroqChoice } from "./models";

type Health = { ok: boolean; message: string; at: number };

const cache = new Map<string, Health>();
const OK_TTL_MS = 60_000;
const BAD_TTL_MS = 20_000;

export function clearProviderHealthCache() {
  cache.clear();
}

async function errorText(response: Response) {
  const body = await response.text().catch(() => "");
  return `${response.status} ${body.replace(/\s+/g, " ").slice(0, 280)}`.trim();
}

async function probeOnce(name: string, settings: AppSettings): Promise<{ ok: boolean; message: string }> {
  if (name === "rules") return { ok: true, message: "ตัวคัดด้วยคีย์เวิร์ดพร้อมใช้งานเสมอ ไม่ต้องต่อเน็ต" };
  try {
    if (name === "ollama") {
      const response = await fetch(`${settings.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return { ok: false, message: `Ollama ใช้ไม่ได้: ${await errorText(response)}` };
      const data = await response.json();
      const names: string[] = (data.models ?? []).map((model: { name?: string }) => model.name ?? "");
      const found = names.some((item) => item === settings.ollamaModel || item.startsWith(`${settings.ollamaModel}:`));
      return found
        ? { ok: true, message: `Ollama พร้อม โมเดล ${settings.ollamaModel}` }
        : { ok: false, message: `Ollama ตอบได้ แต่ยังไม่มีโมเดล ${settings.ollamaModel}` };
    }
    if (name === "gemini") {
      if (!settings.geminiApiKey) return { ok: false, message: "ยังไม่มี GEMINI_API_KEY" };
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.geminiModel)}?key=${encodeURIComponent(settings.geminiApiKey)}`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (!response.ok) return { ok: false, message: `Gemini ใช้ไม่ได้: ${await errorText(response)}` };
      return { ok: true, message: `Gemini พร้อม โมเดล ${settings.geminiModel}` };
    }
    if (name === "groq") {
      if (!settings.groqApiKey) return { ok: false, message: "ยังไม่มี GROQ_API_KEY" };
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { authorization: `Bearer ${settings.groqApiKey}` },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) return { ok: false, message: `Groq ใช้ไม่ได้: ${await errorText(response)}` };
      const data = await response.json();
      const ids: string[] = (data.data ?? []).map((model: { id?: string }) => model.id ?? "").filter(Boolean);
      const decision = groqAvailability(settings.groqModel, ids, true);
      rememberGroqChoice(settings.groqModel, decision.model);
      return { ok: decision.ok, message: decision.message };
    }
    return { ok: false, message: "ไม่รู้จักผู้ให้บริการ" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "เชื่อมต่อไม่สำเร็จ";
    return { ok: false, message };
  }
}

export async function probeProvider(name: string, settings: AppSettings, fresh = false) {
  if (fresh) cache.delete(name);
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < (hit.ok ? OK_TTL_MS : BAD_TTL_MS)) {
    return { ok: hit.ok, message: hit.message };
  }
  const result = await probeOnce(name, settings);
  cache.set(name, { ...result, at: Date.now() });
  return result;
}

export type ProviderName = "ollama" | "gemini" | "groq";

export async function selectReadyProviders(
  order: readonly ProviderName[],
  settings: AppSettings,
  probe: (name: ProviderName, settings: AppSettings) => Promise<{ ok: boolean; message: string }> = probeProvider,
) {
  const ready: ProviderName[] = [];
  const errors: { name: string; message: string }[] = [];
  for (const name of order) {
    if (name === "gemini" && !settings.geminiApiKey) {
      errors.push({ name, message: "ข้าม Gemini เพราะไม่มี GEMINI_API_KEY" });
      continue;
    }
    if (name === "groq" && !settings.groqApiKey) {
      errors.push({ name, message: "ข้าม Groq เพราะไม่มี GROQ_API_KEY" });
      continue;
    }
    const health = await probe(name, settings);
    if (!health.ok) {
      errors.push({ name, message: health.message });
      continue;
    }
    ready.push(name);
  }
  return { ready, errors };
}
