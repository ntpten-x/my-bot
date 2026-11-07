import { isTruncatedText } from "./pipeline/truncation";
import { postKeyFromUrl } from "./scrape-plan";

export const REFETCH_PER_SOURCE = 10;
export const REFETCH_MAX_ATTEMPTS = 8;
export const REFETCH_BACKOFF_MS = 45 * 60_000;
const KEYS_PER_SOURCE = 300;

export type RefetchRow = { id: string; externalUrl: string; score: number; createdAt: Date; refetchAttempts: number };

/** Pure: newest and high-score first; posts tried fewer times win ties. */
export function rankRefetch(rows: RefetchRow[], now: Date, limit = REFETCH_PER_SOURCE) {
  const weight = (row: RefetchRow) => {
    const ageHours = Math.max(0, (now.getTime() - row.createdAt.getTime()) / 3600_000);
    return row.score + Math.max(0, 48 - ageHours) - row.refetchAttempts * 5;
  };
  return [...rows].sort((a, b) => weight(b) - weight(a)).slice(0, limit);
}

export type HintPostRow = {
  sourceId: string;
  externalUrl: string;
  postedAt: Date | null;
  createdAt: Date;
  text: string;
};

export type KnownHint = {
  keys: string[];
  lastSeenAt: string | null;
  legacyTruncated: string[];
};

/** Pure: group a batched post query into per-source knownKeys / lastSeen / legacy truncated URLs. */
export function buildKnownHints(sourceIds: string[], rows: HintPostRow[], _now = new Date()): Map<string, KnownHint> {
  const hints = new Map<string, KnownHint>();
  for (const id of sourceIds) hints.set(id, { keys: [], lastSeenAt: null, legacyTruncated: [] });
  const counts = new Map<string, number>();
  for (const row of rows) {
    const hint = hints.get(row.sourceId);
    if (!hint) continue;
    const taken = counts.get(row.sourceId) ?? 0;
    if (taken >= KEYS_PER_SOURCE) continue;
    counts.set(row.sourceId, taken + 1);
    const key = postKeyFromUrl(row.externalUrl);
    if (key && !hint.keys.includes(key)) hint.keys.push(key);
    if (row.postedAt && (!hint.lastSeenAt || row.postedAt.toISOString() > hint.lastSeenAt)) {
      hint.lastSeenAt = row.postedAt.toISOString();
    }
    if (isTruncatedText(row.text) && hint.legacyTruncated.length < REFETCH_PER_SOURCE && !hint.legacyTruncated.includes(row.externalUrl)) {
      hint.legacyTruncated.push(row.externalUrl);
    }
  }
  return hints;
}

export type RefetchPoolRow = RefetchRow & { sourceId: string };

/** Pure: pick refetch URLs per source from one batched truncated-post pool. */
export function pickRefetchFromPool(
  sourceIds: string[],
  pool: RefetchPoolRow[],
  now: Date,
  limit = REFETCH_PER_SOURCE,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of sourceIds) {
    const rows = pool.filter((row) => row.sourceId === id);
    out.set(
      id,
      rankRefetch(rows, now, limit).map((row) => row.externalUrl),
    );
  }
  return out;
}

/** Merge ranked refetch URLs with legacy truncated URLs from known-key rows. */
export function mergeRefetchUrls(ranked: string[], legacy: string[], limit = REFETCH_PER_SOURCE) {
  const urls = [...ranked];
  for (const url of legacy) if (urls.length < limit && !urls.includes(url)) urls.push(url);
  return urls;
}
