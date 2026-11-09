import type { AppSettings } from "../settings";
import type { ProviderIssue } from "../pipeline/classify";
const BAD_TTL_MS = 20_000;
export function clearProviderHealthCache() {}
export async function probeProvider(_name: string, _settings: AppSettings, _fresh = false) { void _name; void _settings; void _fresh;  return { ok: false, message: "AI_REMOVED" }; }
export type ProviderName = "ollama" | "gemini" | "groq";

export async function selectReadyProviders(
  order: readonly ProviderName[],
  settings: AppSettings,
  probe: (name: ProviderName, settings: AppSettings) => Promise<{ ok: boolean; message: string }> = probeProvider,
) {
  const ready: ProviderName[] = [];
  const errors: ProviderIssue[] = [];
  for (const name of order) {
    if (name === "gemini" && !settings.geminiApiKey) {
      errors.push({ name, message: "ข้าม Gemini เพราะไม่มี GEMINI_API_KEY", deferred: true });
      continue;
    }
    if (name === "groq" && !settings.groqApiKey) {
      errors.push({ name, message: "ข้าม Groq เพราะไม่มี GROQ_API_KEY", deferred: true });
      continue;
    }
    const health = await probe(name, settings);
    if (!health.ok) {
      errors.push({ name, message: health.message, deferred: true, retryAt: name === "ollama" && process.env.OLLAMA_DISABLED === "1" ? undefined : Date.now() + BAD_TTL_MS });
      continue;
    }
    ready.push(name);
  }
  return { ready, errors };
}
