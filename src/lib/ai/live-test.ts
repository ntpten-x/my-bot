import type { AppSettings } from "../settings";
export type LiveTest = {
  ok: boolean;
  configured: boolean;
  latencyMs: number | null;
  model: string;
  message: string;
  hint?: string;
  testedAt: string | null;
};


export async function liveTestProvider(_name: "groq" | "gemini", _settings: AppSettings, _fresh = false): Promise<LiveTest> { void _name; void _settings; void _fresh;
  return { ok: false, configured: false, latencyMs: null, model: "", message: "AI_REMOVED", testedAt: null };
}
