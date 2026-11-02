export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

export const GROQ_MODEL_PREFERENCES = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "qwen/qwen3-32b",
];

export function pickGroqModel(requested: string, available: string[]): string {
  const wanted = requested.trim();
  if (wanted && available.includes(wanted)) return wanted;
  for (const preferred of GROQ_MODEL_PREFERENCES) {
    if (available.includes(preferred)) return preferred;
  }
  const similar = available.find((id) => /gpt-oss|qwen/i.test(id));
  return similar || available[0] || wanted || DEFAULT_GROQ_MODEL;
}

export function groqAvailability(requested: string, ids: string[], httpOk: boolean, errorMessage = "") {
  if (!httpOk) return { ok: false, model: requested, message: errorMessage || "Groq ใช้ไม่ได้" };
  if (!ids.length) return { ok: true, model: requested, message: `Groq พร้อม โมเดล ${requested}` };
  const model = pickGroqModel(requested, ids);
  if (model !== requested) {
    return { ok: true, model, message: `บัญชีนี้ไม่มี ${requested} จึงใช้ ${model}` };
  }
  return { ok: true, model, message: `Groq พร้อม โมเดล ${model}` };
}

const RETIRED_GROQ_MODELS = new Set([
  "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile",
  "llama3-8b-8192",
  "llama3-70b-8192",
  "mixtral-8x7b-32768",
  "gemma-7b-it",
  "gemma2-9b-it",
]);

const chosenGroqModels = new Map<string, string>();

export function rememberGroqChoice(requested: string, model: string) {
  if (requested && model) chosenGroqModels.set(requested, model);
}

export function effectiveGroqModel(requested: string) {
  return chosenGroqModels.get(requested) || requested;
}

export function resolveGroqModel(value: string | undefined | null): string {
  const model = (value ?? "").trim();
  if (!model || RETIRED_GROQ_MODELS.has(model)) return DEFAULT_GROQ_MODEL;
  return model;
}
