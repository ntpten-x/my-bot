/** What a group (source) mostly posts about, from its recent labelled posts. */
export type GroupHint = { categorySlug: string; share: number; total: number; productSlug?: string | null };

/** A group needs this many labelled posts before its profile is trusted. */
export const MIN_PROFILE_POSTS = 10;
/** Share at which one category "owns" a group and breaks ties for unclear posts. */
export const DOMINANT_SHARE = 0.7;

export function dominantHint(counts: Record<string, number>, minTotal = MIN_PROFILE_POSTS): GroupHint | null {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total < minTotal) return null;
  let best: { slug: string; count: number } | null = null;
  for (const [slug, count] of Object.entries(counts)) {
    if (slug === "other" || !slug) continue;
    if (!best || count > best.count) best = { slug, count };
  }
  if (!best) return null;
  // "other" is mostly what the classifier could not place, so the share is measured among labelled posts.
  const labelled = total - (counts.other ?? 0) - (counts[""] ?? 0);
  return { categorySlug: best.slug, share: labelled > 0 ? best.count / labelled : 0, total };
}

export function isDominant(hint: GroupHint | null | undefined, slug?: string) {
  return Boolean(hint && hint.total >= MIN_PROFILE_POSTS && hint.share >= DOMINANT_SHARE && (!slug || hint.categorySlug === slug));
}

/** Short Thai line for the AI prompt, e.g. "games 82%". */
export function hintLabel(hint: GroupHint | null | undefined) {
  if (!hint || hint.share < 0.5) return undefined;
  return `${hint.categorySlug} ${Math.round(hint.share * 100)}%${hint.productSlug ? ` ${hint.productSlug}` : ""}`;
}
