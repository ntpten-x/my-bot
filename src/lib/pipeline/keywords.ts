import { normalizeText } from "./normalize";

export type KeywordRule = { word: string; type: "watch" | "forbidden" };

export function matchKeywords(text: string, rules: KeywordRule[]) {
  const normalized = normalizeText(text);
  const watch: string[] = [];
  const forbidden: string[] = [];
  for (const rule of rules) {
    const word = normalizeText(rule.word);
    if (!word) continue;
    if (!normalized.includes(word)) continue;
    if (rule.type === "forbidden") forbidden.push(rule.word);
    else watch.push(rule.word);
  }
  return {
    watch,
    forbidden,
    matched: watch.length > 0 && forbidden.length === 0,
  };
}
