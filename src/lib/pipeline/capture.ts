import { normalizeText } from "./normalize";

export const PREFIX_DUP_MIN = 60;

const TRUNCATION = /ดูเพิ่มเติม|see more|…|\.{2,}/gi;

export function hasTruncationMarker(text: string) {
  return /ดูเพิ่มเติม|see more|…|\.{2,}/i.test(text);
}

export function stripTruncationMarkers(text: string) {
  return text.replace(TRUNCATION, " ").replace(/\s+/g, " ").trim();
}

export function captureText(text: string) {
  return normalizeText(stripTruncationMarkers(text));
}

export function chooseKeeper(leftText: string, rightText: string): "left" | "right" | null {
  const left = captureText(leftText);
  const right = captureText(rightText);
  if (!left || !right) return null;
  if (left === right) {
    if (left.length < PREFIX_DUP_MIN) return null;
    const leftMarked = hasTruncationMarker(leftText);
    const rightMarked = hasTruncationMarker(rightText);
    if (leftMarked && !rightMarked) return "right";
    if (rightMarked && !leftMarked) return "left";
    return leftText.length >= rightText.length ? "left" : "right";
  }
  if (right.startsWith(left) && left.length >= PREFIX_DUP_MIN && right.length > left.length) return "right";
  if (left.startsWith(right) && right.length >= PREFIX_DUP_MIN && left.length > right.length) return "left";
  return null;
}

export function sameSourceCapture(
  left: { sourceId: string; text: string },
  right: { sourceId: string; text: string },
) {
  if (left.sourceId !== right.sourceId) return null;
  return chooseKeeper(left.text, right.text);
}

export function mergePermalinks(primary: string, lists: string[][]) {
  const seen = new Set([primary.trim()]);
  const extras: string[] = [];
  for (const list of lists) {
    for (const url of list) {
      const clean = url.trim();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      extras.push(clean);
    }
  }
  return extras;
}

export function readUrlList(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}
