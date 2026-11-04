import { createHash } from "crypto";
import { canonicalMarketplaceUrl, isMarketplaceUrl, marketplaceSourceName } from "../scrape-plan";

const DROP_PARAMS = new Set([
  "fbclid",
  "ref",
  "__tn__",
  "mibextid",
  "rdid",
  "share_url",
  "refsrc",
  "paipv",
  "__cft__",
]);

export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (DROP_PARAMS.has(key) || key.startsWith("utm_")) url.searchParams.delete(key);
    }
    let host = url.hostname.toLowerCase().replace(/^m\./, "").replace(/^web\./, "");
    if (host === "facebook.com") host = "www.facebook.com";
    const path = url.pathname.replace(/\/+$/, "");
    const query = url.searchParams.toString();
    return `${url.protocol}//${host}${path}${query ? `?${query}` : ""}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

export function canonicalSourceUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    let host = url.hostname.toLowerCase().replace(/^m\./, "").replace(/^web\./, "");
    if (host === "facebook.com") host = "www.facebook.com";
    const path = url.pathname.replace(/\/+$/, "");
    const group = path.match(/^\/groups\/([^/]+)/i);
    if (host.endsWith("facebook.com") && group) {
      return `https://www.facebook.com/groups/${group[1]}`;
    }
    if (isMarketplaceUrl(url.toString())) return canonicalMarketplaceUrl(url.toString());
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "fbclid") url.searchParams.delete(key);
    }
    const query = url.searchParams.toString();
    return `${url.protocol}//${host}${path}${query ? `?${query}` : ""}`;
  } catch {
    return input.trim();
  }
}

export function contentHash(text: string, url: string): string {
  const basis = `${normalizeText(text)}|${normalizeUrl(url)}`;
  return createHash("sha256").update(basis).digest("hex");
}

export function detectSourceType(url: string): "facebook_group" | "facebook_marketplace" | "rss" | "web_board" {
  const value = url.toLowerCase();
  if (isMarketplaceUrl(url)) return "facebook_marketplace";
  if (value.includes("facebook.com/groups/") || value.includes("web.facebook.com/groups/")) {
    return "facebook_group";
  }
  if (value.includes("rss") || value.endsWith(".xml") || value.includes("/feed") || value.includes("atom")) {
    return "rss";
  }
  return "web_board";
}

export function defaultSourceName(url: string, type: string): string {
  if (type === "facebook_marketplace") return marketplaceSourceName(url);
  if (type === "facebook_group") {
    const match = url.match(/groups\/([^/?#]+)/i);
    if (match) {
      try {
        return `กลุ่ม ${decodeURIComponent(match[1])}`;
      } catch {
        return `กลุ่ม ${match[1]}`;
      }
    }
    return "กลุ่ม Facebook";
  }
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 80);
  }
}
