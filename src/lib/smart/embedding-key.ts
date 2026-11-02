import { createHash } from "node:crypto";
import type { AppSettings } from "../settings";

export function embeddingConfig(settings: Pick<AppSettings, "ollamaBaseUrl" | "embedModel" | "geminiEmbedModel">) {
  return createHash("sha256").update(JSON.stringify([settings.ollamaBaseUrl, settings.embedModel, settings.geminiEmbedModel, "v1"])).digest("hex");
}

export function embeddingTextKey(text: string, config: string) {
  return createHash("sha256").update(`${config}\n${text}`).digest("hex");
}

export function readVector(value: string | null | undefined): number[] | null {
  try {
    const parsed: unknown = JSON.parse(value || "null");
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(n => typeof n === "number" && Number.isFinite(n)) ? parsed : null;
  } catch { return null; }
}
