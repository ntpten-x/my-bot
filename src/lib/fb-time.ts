// Server copy of the extension's Facebook time parser (extension/fbtime.js is the single source of truth).
import fbTime from "../../extension/fbtime.js";

const api = fbTime as { parseFbTime: (input: string, nowMs?: number) => string | null };

export function parseFbTime(input: string, nowMs?: number): string | null {
  return api.parseFbTime(input, nowMs);
}
