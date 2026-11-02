import { normalizeText } from "../pipeline/normalize";

const STOP = new Set(["ครับ", "ค่ะ", "คะ", "นะ", "ได้", "มี", "ใน", "และ", "กับ", "ของ", "ที่", "นี้", "เลย", "ไหม", "หรือ", "เป็น", "แล้ว", "ให้", "ไม่", "ว่า"]);

function tokensOf(text: string) {
  const normalized = normalizeText(text);
  const found = new Set<string>();
  for (const word of normalized.split(" ")) {
    if (word.length >= 3 && !STOP.has(word)) found.add(word);
  }
  const thai = normalized.replace(/[^\u0E00-\u0E7F]/g, "");
  for (const size of [4, 6, 8]) {
    for (let index = 0; index + size <= thai.length && index < 48; index += 2) {
      const gram = thai.slice(index, index + size);
      if (!STOP.has(gram)) found.add(gram);
    }
  }
  return found;
}

export function mineSuggestions(liked: string[], disliked: string[], watch: string[] = [], forbidden: string[] = []) {
  const watchSet = new Set(watch.map((word) => normalizeText(word)));
  const forbiddenSet = new Set(forbidden.map((word) => normalizeText(word)));
  const likedCount = new Map<string, number>();
  const dislikedCount = new Map<string, number>();
  for (const text of liked) {
    for (const token of tokensOf(text)) likedCount.set(token, (likedCount.get(token) ?? 0) + 1);
  }
  for (const text of disliked) {
    for (const token of tokensOf(text)) dislikedCount.set(token, (dislikedCount.get(token) ?? 0) + 1);
  }
  const keys = new Set([...likedCount.keys(), ...dislikedCount.keys()]);
  const watchSuggestions: { word: string; support: number }[] = [];
  const forbiddenSuggestions: { word: string; support: number }[] = [];
  for (const key of keys) {
    const up = likedCount.get(key) ?? 0;
    const down = dislikedCount.get(key) ?? 0;
    if (up >= 2 && up > down && !watchSet.has(key)) watchSuggestions.push({ word: key, support: up });
    if (down >= 2 && down > up && !forbiddenSet.has(key)) forbiddenSuggestions.push({ word: key, support: down });
  }
  const bySupport = (left: { support: number }, right: { support: number }) => right.support - left.support;
  return {
    watch: watchSuggestions.sort(bySupport).slice(0, 8),
    forbidden: forbiddenSuggestions.sort(bySupport).slice(0, 8),
  };
}
