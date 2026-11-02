export const OLLAMA_PORT_CANDIDATES = ["http://127.0.0.1:11434", "http://127.0.0.1:41434"];

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
