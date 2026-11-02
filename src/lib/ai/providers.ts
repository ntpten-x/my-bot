import type { CatNode } from "../pipeline/catalog";
import type { ClassifyInput, LooseAiItem } from "../pipeline/classify-rules";
import type { AppSettings } from "../settings";
import { probeProvider } from "./health";
import { ProviderHttpError, backoffMs, takeToken } from "./bucket";
import { effectiveGroqModel, pickGroqModel, rememberGroqChoice } from "./models";
import { OLLAMA_KEEP_ALIVE, resolveOllamaBaseUrl } from "./ollama-url";
import { extractAiItems } from "./parse";
import { AI_SYSTEM, userPrompt } from "./prompt";

const CLASSIFY_TIMEOUT_MS = 12_000;

function asItems(raw: string): LooseAiItem[] {
  return extractAiItems(raw).map((item) => ({
    id: String(item.id ?? ""),
    categorySlug: item.categorySlug ? String(item.categorySlug) : undefined,
    subcategorySlug:
      item.subcategorySlug === null || item.subcategorySlug === undefined
        ? null
        : String(item.subcategorySlug),
    intent: item.intent ? String(item.intent) : undefined,
    province: item.province === null || item.province === undefined ? null : String(item.province),
    isAd: Boolean(item.isAd),
    suggestedReply: item.suggestedReply ? String(item.suggestedReply) : undefined,
    urgency: typeof item.urgency === "number" ? item.urgency : undefined,
    hasBudget: typeof item.hasBudget === "boolean" ? item.hasBudget : undefined,
    specificity: typeof item.specificity === "number" ? item.specificity : undefined,
  }));
}

async function postJson(url: string, init: RequestInit, attempt = 0): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS) });
  if (response.status === 429 && attempt < 3) {
    const retryAfter = Number(response.headers.get("retry-after") || "2");
    const wait = backoffMs(attempt, Number.isFinite(retryAfter) ? retryAfter : undefined);
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 20_000)));
    return postJson(url, init, attempt + 1);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const retryAfter = Number(response.headers.get("retry-after") || "0");
    const message = `${response.status} ${body.replace(/\s+/g, " ").slice(0, 280)}`;
    throw new ProviderHttpError(message, response.status === 429 ? backoffMs(attempt, retryAfter) : 0);
  }
  return response.json() as Promise<Record<string, never>>;
}

function assertRate(name: string) {
  const ticket = takeToken(name);
  if (!ticket.ok) throw new ProviderHttpError(`${name} rate limit`, ticket.retryAfterMs);
}

export async function ollamaClassify(posts: ClassifyInput[], catalog: CatNode[], settings: AppSettings) {
  assertRate("ollama");
  const ollamaBase = await resolveOllamaBaseUrl(settings.ollamaBaseUrl);
  const data = (await postJson(`${ollamaBase}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: settings.ollamaModel,
      stream: false,
      format: "json",
      keep_alive: OLLAMA_KEEP_ALIVE,
      messages: [
        { role: "system", content: AI_SYSTEM },
        { role: "user", content: userPrompt(posts, catalog) },
      ],
      options: { temperature: 0.2 },
    }),
  })) as { message?: { content?: string } };
  return asItems(String(data.message?.content ?? ""));
}

export async function geminiClassify(posts: ClassifyInput[], catalog: CatNode[], settings: AppSettings) {
  if (!settings.geminiApiKey) throw new Error("ไม่มี GEMINI_API_KEY");
  assertRate("gemini");
  const model = settings.geminiModel || "gemini-2.0-flash";
  const data = (await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${AI_SYSTEM}\n\n${userPrompt(posts, catalog)}` }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    },
  )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n");
  return asItems(String(text ?? ""));
}

async function groqOnce(posts: ClassifyInput[], catalog: CatNode[], settings: AppSettings, model: string) {
  const data = (await postJson("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.groqApiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: AI_SYSTEM },
        { role: "user", content: userPrompt(posts, catalog) },
      ],
    }),
  })) as { choices?: { message?: { content?: string } }[] };
  return asItems(String(data.choices?.[0]?.message?.content ?? ""));
}

export async function groqClassify(posts: ClassifyInput[], catalog: CatNode[], settings: AppSettings) {
  if (!settings.groqApiKey) throw new Error("ไม่มี GROQ_API_KEY");
  assertRate("groq");
  const model = effectiveGroqModel(settings.groqModel);
  try {
    return await groqOnce(posts, catalog, settings, model);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/model|not found|404|400/i.test(message)) throw error;
    const response = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { authorization: `Bearer ${settings.groqApiKey}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw error;
    const data = await response.json();
    const ids: string[] = (data.data ?? []).map((item: { id?: string }) => item.id ?? "").filter(Boolean);
    const chosen = pickGroqModel(settings.groqModel, ids);
    if (!chosen || chosen === model) throw error;
    rememberGroqChoice(settings.groqModel, chosen);
    return groqOnce(posts, catalog, settings, chosen);
  }
}

export async function testProvider(name: string, settings: AppSettings): Promise<{ ok: boolean; message: string }> {
  return probeProvider(name, settings, true);
}
