import type { AiProvider } from "@prisma/client";
import type { AppSettings } from "../settings";
import type { RouterStore } from "./router";
type CallRow = Pick<AiProvider, "kind" | "preset" | "baseUrl" | "model" | "apiKeyEnc">;
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


export async function ensureSeeded(_settings: AppSettings) { void _settings;  /* retired: no registry writes */ }
export async function listProviders() { return []; }
export type ChatResult = { text: string; tokens: number };
export async function chatOnce(_row: CallRow, _system: string, _user: string, _options: { json?: boolean; maxTokens?: number; timeoutMs?: number } = {}): Promise<ChatResult> { void _row; void _system; void _user; void _options;  throw new Error("AI_REMOVED"); }
export async function routedClassifyAttempts(_settings: AppSettings, _store?: RouterStore, _options: { initialize?: boolean } = {}) { void _settings; void _store; void _options;  return null; }
export async function testProviderRow(_row: CallRow & Pick<AiProvider, "id" | "resetHourUtc">) { void _row;  return { ok: false, latencyMs: 0, message: "AI_REMOVED", kind: "removed" }; }
