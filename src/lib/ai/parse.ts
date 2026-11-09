export function parseAiJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const objectFirst = start >= 0 && (arrayStart < 0 || start < arrayStart);
  if (objectFirst && start >= 0) {
    const end = trimmed.lastIndexOf("}");
    if (end > start) return JSON.parse(trimmed.slice(start, end + 1));
  }
  if (arrayStart >= 0) {
    const end = trimmed.lastIndexOf("]");
    if (end > arrayStart) return JSON.parse(trimmed.slice(arrayStart, end + 1));
  }
  throw new Error("ไม่พบ JSON จากโมเดล");
}

export function extractAiItems(raw: string): Array<Record<string, unknown>> {
  let data: unknown;
  try { data = parseAiJson(raw); }
  catch (error) {
    // Providers can truncate a batch mid-answer. Keep only independently valid,
    // complete objects from the root result array; never repair or guess a value.
    const text = raw.trim().replace(/^```(?:json)?/i, "").trim();
    const prefix = text.match(/^(?:\{\s*"(?:items|results|posts)"\s*:\s*)?\[/);
    if (!prefix || text.length > 1_000_000) throw error;
    const complete: Array<Record<string, unknown>> = [];
    let index = prefix[0].length;
    while (index < text.length) {
      while (/\s/.test(text[index] ?? "") && index < text.length) index++;
      if (text[index] !== "{") break;
      const start = index;
      let depth = 0, quoted = false, escaped = false;
      for (; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === "{") depth++;
        else if (char === "}" && --depth === 0) { index++; break; }
      }
      if (depth !== 0 || quoted) break;
      try { complete.push(JSON.parse(text.slice(start, index))); } catch { break; }
      while (/\s/.test(text[index] ?? "") && index < text.length) index++;
      if (text[index] !== ",") break;
      index++;
    }
    if (!complete.length) throw error;
    return complete;
  }
  const items = Array.isArray(data)
    ? data
    : ((data as { items?: unknown; results?: unknown; posts?: unknown }).items ??
      (data as { results?: unknown }).results ??
      (data as { posts?: unknown }).posts);
  if (!Array.isArray(items)) throw new Error("รูปแบบ JSON ไม่ถูกต้อง");
  return items.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
}
