import type { AiProvider } from "@prisma/client";
import type { CatNode } from "../pipeline/catalog";
import type { ClassifyInput, LooseAiItem } from "../pipeline/classify-rules";
import { prisma } from "../prisma";
import type { AppSettings } from "../settings";
import { resolveOllamaBaseUrl, OLLAMA_KEEP_ALIVE, ollamaReachable } from "./ollama-url";
import { extractAiItems } from "./parse";
import { AI_SYSTEM, userPrompt } from "./prompt";
import { presetById, type ProviderKind } from "./provider-presets";
import { AiCallError, bodyHint, guardedCall, orderAvailable, sharedMinuteWindow, type RouterProvider, type RouterStore } from "./router";
import { decryptSecret, encryptSecret, hasKeySecret, maskSecret } from "./secret-box";

const CALL_TIMEOUT_MS = 20_000;
const OLLAMA_TIMEOUT_MS = 60_000;

export type ProviderRow = Omit<AiProvider, "tasks"> & RouterProvider;
type CallRow = Pick<AiProvider, "kind" | "preset" | "baseUrl" | "model" | "apiKeyEnc">;

function toRouter(row: AiProvider): ProviderRow {
  return { ...row, tasks: row.tasks.split(",").map((task) => task.trim()).filter(Boolean) } as unknown as ProviderRow;
}

/** What the browser may see: everything except the encrypted key. */
export function publicProvider(row: AiProvider, now = new Date()) {
  const { apiKeyEnc, ...rest } = row;
  return {
    ...rest,
    hasKey: Boolean(apiKeyEnc),
    tasks: row.tasks.split(",").filter(Boolean),
    coolingDown: Boolean(row.cooldownUntil && row.cooldownUntil.getTime() > now.getTime()),
  };
}
export type PublicProvider = ReturnType<typeof publicProvider>;

export const dbRouterStore: RouterStore = {
  async recordSuccess(id, usage) {
    const row = await prisma.aiProvider.findUnique({ where: { id }, select: { usageDay: true } });
    const sameDay = row?.usageDay === usage.day;
    await prisma.aiProvider.update({
      where: { id },
      data: {
        usageDay: usage.day,
        requestsToday: sameDay ? { increment: 1 } : 1,
        tokensToday: sameDay ? { increment: usage.tokens } : usage.tokens,
        requestsTotal: { increment: 1 },
        tokensTotal: { increment: usage.tokens },
        lastLatencyMs: usage.latencyMs,
        lastUsedAt: usage.now,
        cooldownUntil: null,
        cooldownReason: null,
      },
    });
  },
  async recordFailure(id, failure) {
    const row = await prisma.aiProvider.findUnique({ where: { id }, select: { usageDay: true } });
    const sameDay = row?.usageDay === failure.day;
    await prisma.aiProvider.update({
      where: { id },
      data: {
        usageDay: failure.day,
        requestsToday: sameDay ? { increment: 1 } : 1,
        tokensToday: sameDay ? undefined : 0,
        requestsTotal: { increment: 1 },
        errorsTotal: { increment: 1 },
        lastUsedAt: failure.now,
        lastError: failure.message.slice(0, 200),
        lastErrorAt: failure.now,
        ...(failure.cooldownUntil ? { cooldownUntil: failure.cooldownUntil, cooldownReason: failure.kind } : {}),
      },
    });
  },
};

let seeded = false;

/** First run: copy the env-based Ollama/Gemini/Groq setup into the table, in the old auto order. */
export async function ensureSeeded(settings: AppSettings) {
  if (!hasKeySecret()) return;
  if (seeded) return;
  if (await prisma.aiProvider.count()) {
    seeded = true;
    return;
  }
  const rows: Parameters<typeof prisma.aiProvider.create>[0]["data"][] = [
    { name: "Ollama ในเครื่อง", preset: "ollama", kind: "ollama", baseUrl: settings.ollamaBaseUrl, model: settings.ollamaModel, priority: 10, tasks: "classify,reply-draft", origin: "env" },
  ];
  if (settings.geminiApiKey && hasKeySecret()) {
    rows.push({ name: "Gemini", preset: "gemini", kind: "gemini", baseUrl: presetById("gemini").baseUrl, model: settings.geminiModel || "gemini-2.0-flash", apiKeyEnc: encryptSecret(settings.geminiApiKey), apiKeyHint: maskSecret(settings.geminiApiKey), priority: 20, tasks: "classify,reply-draft", origin: "env", resetHourUtc: 8 });
  }
  if (settings.groqApiKey && hasKeySecret()) {
    rows.push({ name: "Groq", preset: "groq", kind: "openai", baseUrl: presetById("groq").baseUrl, model: settings.groqModel || presetById("groq").model, apiKeyEnc: encryptSecret(settings.groqApiKey), apiKeyHint: maskSecret(settings.groqApiKey), priority: 30, tasks: "classify,reply-draft", origin: "env" });
  }
  await prisma.aiProvider.createMany({ data: rows });
  seeded = true;
}

export async function listProviders() {
  return (await prisma.aiProvider.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] })).map(toRouter);
}

async function postJson(url: string, init: RequestInit, timeoutMs: number) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const header = response.headers.get("retry-after") || "";
    const seconds = Number(header);
    const retryAfterMs = header ? (Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(header) - Date.now()) || 0) : 0;
    // Read the body only to look for quota words; it is never stored or logged.
    const hint = bodyHint(await response.text().catch(() => ""));
    throw new AiCallError(`HTTP ${response.status}`, response.status, retryAfterMs, hint);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return response.json() as Promise<Record<string, any>>;
}

export type ChatResult = { text: string; tokens: number };

/** One chat call in the provider's own wire format. `json` asks for a JSON object answer. */
export async function chatOnce(row: CallRow, system: string, user: string, options: { json?: boolean; maxTokens?: number } = {}): Promise<ChatResult> {
  const key = row.apiKeyEnc ? decryptSecret(row.apiKeyEnc) : "";
  const kind = row.kind as ProviderKind;
  const base = (row.baseUrl || presetById(row.preset).baseUrl).replace(/\/+$/, "");
  if (!row.model && kind !== "ollama") throw new AiCallError("ยังไม่ได้ใส่ชื่อโมเดล", 400);
  if (kind === "ollama") {
    const url = await resolveOllamaBaseUrl(base);
    const data = await postJson(`${url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: row.model,
        stream: false,
        keep_alive: OLLAMA_KEEP_ALIVE,
        ...(options.json ? { format: "json" } : {}),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        options: { temperature: 0.2, ...(options.maxTokens ? { num_predict: options.maxTokens } : {}) },
      }),
    }, OLLAMA_TIMEOUT_MS);
    return { text: String(data.message?.content ?? ""), tokens: Number(data.prompt_eval_count ?? 0) + Number(data.eval_count ?? 0) };
  }
  if (!key) throw new AiCallError("ยังไม่ได้ใส่ API key", 401);
  if (kind === "gemini") {
    const data = await postJson(`${base}/models/${encodeURIComponent(row.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }],
        generationConfig: { temperature: 0.2, ...(options.json ? { responseMimeType: "application/json" } : {}), ...(options.maxTokens ? { maxOutputTokens: options.maxTokens } : {}) },
      }),
    }, CALL_TIMEOUT_MS);
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((part: { text?: string }) => part.text ?? "").join("\n");
    return { text, tokens: Number(data.usageMetadata?.totalTokenCount ?? 0) };
  }
  const send = (jsonMode: boolean) =>
    postJson(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: row.model,
        temperature: 0.2,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    }, CALL_TIMEOUT_MS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: Record<string, any>;
  try {
    data = await send(Boolean(options.json));
  } catch (error) {
    // Some free models reject response_format; retry once in plain mode.
    if (!(options.json && error instanceof AiCallError && error.status === 400 && !error.hint)) throw error;
    data = await send(false);
  }
  return { text: String(data.choices?.[0]?.message?.content ?? ""), tokens: Number(data.usage?.total_tokens ?? 0) };
}

function asItems(raw: string): LooseAiItem[] {
  return extractAiItems(raw).map((item) => ({
    id: String(item.id ?? ""),
    categorySlug: item.categorySlug ? String(item.categorySlug) : undefined,
    subcategorySlug: item.subcategorySlug === null || item.subcategorySlug === undefined ? null : String(item.subcategorySlug),
    intent: item.intent ? String(item.intent) : undefined,
    province: item.province === null || item.province === undefined ? null : String(item.province),
    isAd: Boolean(item.isAd),
    suggestedReply: item.suggestedReply ? String(item.suggestedReply) : undefined,
    urgency: typeof item.urgency === "number" ? item.urgency : undefined,
    hasBudget: typeof item.hasBudget === "boolean" ? item.hasBudget : undefined,
    specificity: typeof item.specificity === "number" ? item.specificity : undefined,
  }));
}

/**
 * Classify attempts for the existing chain, one per available provider in priority order.
 * Returns null when the table has no enabled classify provider, so the old env chain runs.
 */
export async function routedClassifyAttempts(settings: AppSettings, store: RouterStore = dbRouterStore) {
  await ensureSeeded(settings);
  const allRows = await listProviders();
  if (!allRows.length) return null;
  // Skip (never cool down: the DB is shared with other hosts) Ollama rows when this server has no Ollama.
  const reachable = await Promise.all(allRows.map(async row => row.kind !== "ollama" || await ollamaReachable(row.baseUrl || settings.ollamaBaseUrl)));
  const rows = allRows.filter((_, index) => reachable[index]);
  const { ready, skipped } = orderAvailable(rows, "classify", new Date(), sharedMinuteWindow);
  const providers = ready.map((row) => ({
    name: `${row.preset === "custom" ? "ai" : row.preset}:${row.name}`.slice(0, 60),
    classify: (batch: ClassifyInput[], tree: CatNode[]) =>
      guardedCall(row, "classify", { store }, async () => {
        const result = await chatOnce(row, AI_SYSTEM, userPrompt(batch, tree), { json: true });
        const items = asItems(result.text);
        if (!items.length) throw new Error("ตอบกลับว่างหรืออ่าน JSON ไม่ได้");
        return { value: items, tokens: result.tokens };
      }),
  }));
  return { providers, managedPresets: allRows.map(row => row.preset), errors: skipped.map((item) => ({ name: item.name, message: item.reason })) };
}

/** Owner pressed "ทดสอบ": one tiny real call. Success clears a cooldown; failure only notes the error. */
export async function testProviderRow(row: CallRow & Pick<AiProvider, "id" | "resetHourUtc">) {
  const start = Date.now();
  try {
    const result = await chatOnce(row, "Reply with JSON only.", 'Return {"ok":true,"word":"สวัสดี"}', { json: true, maxTokens: 40 });
    const latencyMs = Date.now() - start;
    await prisma.aiProvider.update({ where: { id: row.id }, data: { lastLatencyMs: latencyMs, cooldownUntil: null, cooldownReason: null, lastError: null } });
    return { ok: true, latencyMs, message: `ตอบกลับใน ${latencyMs} ms`, sample: result.text.replace(/\s+/g, " ").slice(0, 80), tokens: result.tokens };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const { classifyFailure } = await import("./router");
    const failure = classifyFailure(error, new Date(), row.resetHourUtc);
    await prisma.aiProvider.update({ where: { id: row.id }, data: { lastError: failure.message, lastErrorAt: new Date() } });
    return { ok: false, latencyMs, message: failure.message, kind: failure.kind };
  }
}