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


export function clearOllamaUrlCache() {}
export async function resolveOllamaBaseUrl(_configured?: string) { void _configured;  return ""; }
export async function ollamaReachable(_configured?: string) { void _configured;  return false; }
