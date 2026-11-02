const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;

export function searchTokens(query: string): string[] {
  const raw = query.match(TOKEN) ?? [];
  const out: string[] = [];
  for (const token of raw) {
    const clean = token.trim();
    if (clean.length < 2 && !/[a-z0-9]/i.test(clean)) continue;
    if (!out.some((item) => item.toLowerCase() === clean.toLowerCase())) out.push(clean);
  }
  return out.slice(0, 8);
}

export function lexicalScore(query: string, text: string): number {
  const tokens = searchTokens(query);
  if (!tokens.length || !text) return 0;
  const hay = text.toLowerCase();
  let matched = 0;
  let weight = 0;
  let possible = 0;
  for (const token of tokens) {
    const latin = /[a-z0-9]/i.test(token);
    const termWeight = latin ? 2.4 : Math.min(1.8, 0.7 + token.length / 6);
    possible += termWeight;
    if (hay.includes(token.toLowerCase())) {
      matched += 1;
      weight += termWeight;
    }
  }
  if (!matched || possible === 0) return 0;
  return (matched / tokens.length) * (weight / possible);
}

export function blendScores(lexical: number, semantic: number): number {
  const sem = Number.isFinite(semantic) ? Math.max(0, Math.min(1, semantic)) : 0;
  const lex = Math.max(0, Math.min(1, lexical));
  if (lex === 0) return sem * 0.35;
  const product = lex >= 0.45 ? 0.08 : 0;
  return lex * 0.72 + sem * 0.28 + product;
}

export function rankHybrid<T extends { id: string; text: string }>(
  query: string,
  posts: T[],
  semantic: Map<string, number> = new Map(),
): T[] {
  const ranked = posts.map((post, index) => ({
    post,
    index,
    score: blendScores(lexicalScore(query, post.text), semantic.get(post.id) ?? 0),
  }));
  ranked.sort((left, right) => right.score - left.score || left.index - right.index);
  const seenId = new Set<string>();
  const seenText = new Set<string>();
  const out: T[] = [];
  for (const row of ranked) {
    if (seenId.has(row.post.id)) continue;
    const key = row.post.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (key && seenText.has(key)) continue;
    seenId.add(row.post.id);
    if (key) seenText.add(key);
    out.push(row.post);
  }
  return out;
}
