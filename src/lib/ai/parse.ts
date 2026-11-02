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
  const data = parseAiJson(raw);
  const items = Array.isArray(data)
    ? data
    : ((data as { items?: unknown; results?: unknown; posts?: unknown }).items ??
      (data as { results?: unknown }).results ??
      (data as { posts?: unknown }).posts);
  if (!Array.isArray(items)) throw new Error("รูปแบบ JSON ไม่ถูกต้อง");
  return items.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
}
