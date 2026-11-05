export const OLLAMA_PORT_CANDIDATES = ["http://127.0.0.1:11434", "http://127.0.0.1:41434"];
export const OLLAMA_KEEP_ALIVE = "30m";

export function ollamaBaseCandidates(configured?: string): string[] {
  const ordered: string[] = [];
  const add = (value?: string) => {
    if (!value) return;
    const clean = value.trim().replace(/\/$/, "");
    if (clean && !ordered.includes(clean)) ordered.push(clean);
  };
  add(configured);
  for (const item of OLLAMA_PORT_CANDIDATES) add(item);
  return ordered;
}

let cached: { url: string; at: number } | null = null;

export function clearOllamaUrlCache() {
  cached = null;
}

export async function resolveOllamaBaseUrl(configured?: string): Promise<string> {
  if (cached && Date.now() - cached.at < 60_000) return cached.url;
  const candidates = ollamaBaseCandidates(configured);
  for (const url of candidates) {
    try {
      const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(800) });
      if (response.ok) {
        cached = { url, at: Date.now() };
        return url;
      }
    } catch {
      continue;
    }
  }
  return candidates[0];
}

let reach: { ok: boolean; at: number } | null = null;

/** Is any Ollama server answering from this host? Cached ~45 s so a cloud deploy without Ollama skips it cheaply. */
export async function ollamaReachable(configured?: string): Promise<boolean> {
  if (process.env.OLLAMA_DISABLED === "1") return false;
  if (reach && Date.now() - reach.at < 45_000) return reach.ok;
  let ok = false;
  for (const url of ollamaBaseCandidates(configured || process.env.OLLAMA_BASE_URL)) {
    try {
      const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(800) });
      if (response.ok) {
        ok = true;
        break;
      }
    } catch {
      continue;
    }
  }
  reach = { ok, at: Date.now() };
  return ok;
}
