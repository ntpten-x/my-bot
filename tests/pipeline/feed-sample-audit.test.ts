import { describe, it, expect } from "vitest";
import { prepareFeedSample, summarizeFeedSample } from "@/lib/feed-sample-audit";

const source = { id: "s1", type: "facebook_group", url: "https://www.facebook.com/groups/42" };
const row = { id: "p1", sourceId: "s1", externalUrl: "https://www.facebook.com/groups/42/permalink/123?ref=x", intent: "seller", isAd: false, truncated: true, createdAt: new Date("2026-11-12T01:00:00Z"), postedAt: null, processingState: "done", aiProvider: null, aiJobs: [] };
describe("feed sample audit", () => {
  it("deduplicates aliases while keeping missing and unlabeled denominators explicit", () => {
    const sample = prepareFeedSample(source, [
      { url: "https://m.facebook.com/groups/42/posts/123/?fbclid=x", expectedIntent: "buyer", expectedFullText: true },
      { url: "https://www.facebook.com/groups/42?multi_permalinks=123" },
      { url: "https://www.facebook.com/groups/42/posts/456", expectedIntent: "seller" },
      { url: "https://www.facebook.com/groups/42/posts/789" },
    ]);
    const report = summarizeFeedSample(sample, [row]);
    expect(report.counts).toMatchObject({ submitted: 4, unique: 3, duplicates: 1, found: 1, missing: 2, truncated: 1, labeledCaptured: 1, labeledMissing: 1, unlabeled: 1 });
    expect(report.classification.buyer).toMatchObject({ recall: 0, precision: null, expected: 1, predicted: 0 });
    expect(report.classification.seller).toMatchObject({ recall: null, precision: 0 });
    expect(report.results[0]).toMatchObject({ fullText: "truncated", fetchedAt: null, ingestedAt: "2026-11-12T01:00:00.000Z", aiStatus: "unknown" });
    expect(JSON.stringify(report)).not.toContain('"text"');
  });
  it("does not accept other hosts, malformed URLs, non-post URLs or wrong groups", () => {
    const sample = prepareFeedSample(source, [{url:"oops"},{url:"https://facebook.com.evil/groups/42/posts/123"},{url:"https://www.facebook.com/groups/42"},{url:"https://www.facebook.com/groups/99/posts/123"}]);
    expect(sample.entries.map(x => x.status)).toEqual(["invalid_url", "unrecognized_url", "unrecognized_url", "source_mismatch"]);
  });
  it("does not match same post identity stored under another source", () => {
    const sample = prepareFeedSample(source, [{url:"https://www.facebook.com/groups/42/posts/123"}]);
    expect(summarizeFeedSample(sample,[{...row,sourceId:"s2"}]).counts.found).toBe(0);
  });
  it("reports incomplete lookup without claiming missing and flags conflicting labels", () => {
    const sample = prepareFeedSample(source,[{url:"https://www.facebook.com/groups/42/posts/123",expectedIntent:"buyer"},{url:"https://www.facebook.com/groups/42/permalink/123",expectedIntent:"seller"}]);
    const report = summarizeFeedSample(sample,[],true);
    expect(report.results[0]).toMatchObject({status:"lookup_limited",labelConflict:true,expectedIntent:null});
    expect(report.counts.missing).toBe(0);
  });
  it("matches marketplace aliases and gives unknown class its own denominator", () => {
    const sample = prepareFeedSample({id:"s1",type:"facebook_marketplace",url:"https://www.facebook.com/marketplace/bangkok"},[{url:"https://m.facebook.com/marketplace/item/999/?ref=x",expectedIntent:"unknown",expectedFullText:true}]);
    const report=summarizeFeedSample(sample,[{...row,externalUrl:"https://www.facebook.com/marketplace/item/999",intent:"unknown",truncated:false}]);
    expect(report.classification.unknown).toMatchObject({precision:1,recall:1});
    expect(report.results[0].fullTextRequirementMet).toBeNull();
  });
});
