import { postKeyFromUrl } from "./scrape-plan";

export const FEED_SAMPLE_LIMIT = 50;
export const FEED_AUDIT_BODY_LIMIT = 32 * 1024;
export const FEED_AUDIT_ROW_LIMIT = 500;
export const SAMPLE_INTENTS = ["buyer", "seller", "ad", "unknown"] as const;
export type SampleIntent = typeof SAMPLE_INTENTS[number];
export type FeedSampleInput = { url: string; expectedIntent?: SampleIntent; expectedFullText?: boolean };
type AuditSource = { id: string; type: string; url: string; fbGroupId?: string | null };
type Entry = { url: string | null; key: string | null; status: string; expectedIntent: SampleIntent | null; expectedFullText: boolean; labelConflict: boolean; aliases: number };
export type PreparedFeedSample = { sourceId: string; submitted: number; duplicates: number; entries: Entry[]; candidates: string[] };
export type FeedAuditRow = { id: string; sourceId: string; externalUrl: string; intent: string; isAd: boolean; truncated: boolean; createdAt: Date; postedAt: Date | null; processingState: string; aiProvider: string | null; aiJobs: {status: string}[] };

/** URL parsing only. This function must never resolve or fetch the owner's URLs. */
export function prepareFeedSample(source: AuditSource, items: FeedSampleInput[], expectedFullText = false): PreparedFeedSample {
  const entries: Entry[] = [];
  const byKey = new Map<string, Entry>();
  const candidates = new Set<string>();
  let duplicates = 0;
  const sourceGroup = new URL(source.url).pathname.match(/^\/groups\/([^/]+)/i)?.[1];
  for (const item of items) {
    const entry: Entry = { url: null, key: null, status: "invalid_url", expectedIntent: item.expectedIntent ?? null, expectedFullText: item.expectedFullText ?? expectedFullText, labelConflict: false, aliases: 1 };
    let url: URL;
    try { url = new URL(item.url.trim()); } catch { entries.push(entry); continue; }
    entry.status = "unrecognized_url";
    if (!["http:", "https:"].includes(url.protocol) || !/^(?:(?:www|web|m)\.)?facebook\.com$/i.test(url.hostname) || url.username || url.password || url.port) { entries.push(entry); continue; }
    const group = url.pathname.match(/^\/groups\/([^/]+)(?:\/(?:posts|permalink)\/\d+\/?|\/?)$/i);
    const marketplace = /^\/marketplace\/item\/\d+\/?$/i.test(url.pathname);
    const story = /^\/(?:story|permalink)\.php$/i.test(url.pathname) && /^\d+$/.test(url.searchParams.get("story_fbid") || "");
    const key = postKeyFromUrl(url.toString());
    if ((!group && !marketplace && !story) || !/^(p|mp):\d+$/.test(key)) { entries.push(entry); continue; }
    if ((source.type === "facebook_group" && (marketplace || (group && ![sourceGroup, source.fbGroupId].includes(group[1])))) || (source.type === "facebook_marketplace" && !marketplace)) { entry.status = "source_mismatch"; entries.push(entry); continue; }
    entry.key = key;
    const id = key.split(":")[1];
    entry.url = marketplace ? `https://www.facebook.com/marketplace/item/${id}` : `https://www.facebook.com/groups/${sourceGroup}/posts/${id}`;
    entry.status = "ready";
    const prior = byKey.get(key);
    if (prior) {
      duplicates++;
      prior.aliases++;
      prior.expectedFullText ||= entry.expectedFullText;
      if (prior.expectedIntent && entry.expectedIntent && prior.expectedIntent !== entry.expectedIntent) { prior.labelConflict = true; prior.expectedIntent = null; }
      else if (!prior.labelConflict) prior.expectedIntent ??= entry.expectedIntent;
      continue;
    }
    byKey.set(key, entry);
    entries.push(entry);
    // The sourceId index scopes every candidate search; exact helper keys are checked again below.
    for (const part of marketplace ? [`/marketplace/item/${id}`] : [`/posts/${id}`, `/permalink/${id}`, `story_fbid=${id}`, `multi_permalinks=${id}`]) candidates.add(part);
  }
  return { sourceId: source.id, submitted: items.length, duplicates, entries, candidates: [...candidates] };
}

export function summarizeFeedSample(sample: PreparedFeedSample, rows: FeedAuditRow[], lookupLimited = false) {
  const byKey = new Map<string, FeedAuditRow>();
  for (const row of rows) {
    if (row.sourceId !== sample.sourceId) continue;
    const key = postKeyFromUrl(row.externalUrl);
    // More than one stored alias is represented by one deterministic, most recently ingested row.
    const prior = byKey.get(key);
    if (!prior || row.createdAt > prior.createdAt || (row.createdAt.getTime() === prior.createdAt.getTime() && row.id < prior.id)) byKey.set(key, row);
  }
  const results = sample.entries.map(entry => {
    const row = entry.key ? byKey.get(entry.key) : undefined;
    const status = entry.status !== "ready" ? entry.status : row ? "found" : lookupLimited ? "lookup_limited" : "missing";
    return { ...entry, status, postId: row?.id ?? null, actualIntent: row ? (row.isAd ? "ad" : SAMPLE_INTENTS.includes(row.intent as SampleIntent) ? row.intent as SampleIntent : "unknown") : null,
      fullText: row ? row.truncated ? "truncated" : "not_marked_truncated" : "unknown",
      // Absence of a truncation flag cannot prove complete Facebook text.
      fullTextRequirementMet: entry.expectedFullText && row?.truncated ? false : null,
      ingestedAt: row?.createdAt.toISOString() ?? null, postedAt: row?.postedAt?.toISOString() ?? null,
      fetchedAt: null, processingStatus: row?.processingState ?? "unknown", aiStatus: row?.aiJobs[0]?.status ?? "unknown", aiProvider: row?.aiProvider ?? null };
  });
  const valid = results.filter(row => row.key);
  const captured = valid.filter(row => row.status === "found");
  const labeled = captured.filter(row => row.expectedIntent !== null);
  const classification = Object.fromEntries(SAMPLE_INTENTS.map(intent => {
    const expected = labeled.filter(row => row.expectedIntent === intent).length;
    const predicted = labeled.filter(row => row.actualIntent === intent).length;
    const correct = labeled.filter(row => row.expectedIntent === intent && row.actualIntent === intent).length;
    return [intent, { expected, predicted, correct, precision: predicted ? correct / predicted : null, recall: expected ? correct / expected : null }];
  })) as Record<SampleIntent, {expected:number;predicted:number;correct:number;precision:number|null;recall:number|null}>;
  return { generatedAt: new Date().toISOString(), sourceId: sample.sourceId, lookupLimited,
    scope: "owner_sample_only", caveat: "ความครอบคลุมเป็นสัดส่วนของตัวอย่างที่เจ้าของเลือก ไม่ใช่ recall ของฟีดทั้งหมด; precision/recall คำนวณเฉพาะตัวอย่างที่พบและมีป้ายกำกับ ข้อความที่ไม่ถูกทำเครื่องหมายว่าตัดทอนไม่ใช่หลักฐานว่าครบถ้วน",
    counts: { submitted: sample.submitted, unique: valid.length, duplicates: sample.duplicates, invalid: results.length - valid.length,
      found: captured.length, missing: valid.filter(row => row.status === "missing").length, lookupUnknown: valid.filter(row => row.status === "lookup_limited").length,
      truncated: captured.filter(row => row.fullText === "truncated").length, fullTextRequired: valid.filter(row => row.expectedFullText).length,
      labeledCaptured: labeled.length, labeledMissing: valid.filter(row => row.status === "missing" && row.expectedIntent).length,
      unlabeled: valid.filter(row => !row.expectedIntent).length, labelConflicts: valid.filter(row => row.labelConflict).length },
    sampleCoverage: !lookupLimited && valid.length ? captured.length / valid.length : null, classification, results };
}
export type FeedSampleReport = ReturnType<typeof summarizeFeedSample>;
