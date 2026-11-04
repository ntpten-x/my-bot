/** Facebook cuts long posts with "… See more"; the extension replaces the toggle with "…". */
const TRUNCATED_TAIL = /(?:…|\.{3})\s*(?:(?:ดูเพิ่มเติม|See more|ดูเพิ่ม)\s*)?$|(?:ดูเพิ่มเติม|See more)\s*$/i;

export function isTruncatedText(text: string | null | undefined) {
  return TRUNCATED_TAIL.test(String(text ?? "").trim());
}

function stem(text: string) {
  return String(text)
    .replace(TRUNCATED_TAIL, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** True when `next` is the expanded version of a truncated `previous` (same start, longer, not cut). */
export function isExpansionOf(previous: string, next: string) {
  if (!isTruncatedText(previous) || isTruncatedText(next)) return false;
  const a = stem(previous);
  const b = stem(next);
  if (b.length <= a.length) return false;
  const probe = a.slice(0, Math.min(40, a.length));
  return probe.length >= 6 && b.startsWith(probe);
}
