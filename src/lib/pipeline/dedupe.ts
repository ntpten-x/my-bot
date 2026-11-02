export function dedupeBatch<T extends { hash: string }>(
  items: T[],
  existing: Iterable<string> = [],
): { fresh: T[]; duplicates: T[] } {
  const seen = new Set(existing);
  const fresh: T[] = [];
  const duplicates: T[] = [];
  for (const item of items) {
    if (seen.has(item.hash)) {
      duplicates.push(item);
      continue;
    }
    seen.add(item.hash);
    fresh.push(item);
  }
  return { fresh, duplicates };
}
