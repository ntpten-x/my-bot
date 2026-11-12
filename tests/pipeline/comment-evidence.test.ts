import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/lib/prisma", () => ({ prisma: {} }));
import { buildCommentEvidence, safeEvidenceTarget } from "../../src/lib/auto-comment/evidence";
const at = (seconds: number) => new Date(Date.UTC(2026, 10, 12, 0, 0, seconds));
const fixture = () => ({
  id: "job", postId: "post", postKey: "group:test:123", externalUrl: "https://www.facebook.com/groups/test/posts/123/", sourceId: "s", pageId: "", deliveryMode: "extension", browserFbUserId: "42", message: "ข้อความทดสอบ", status: "browser_observed", dryRun: false, attempts: 1, createdAt: at(12), dispatchedAt: at(20), remoteCommentId: null,
  post: { createdAt: at(0), processingState: "done", aiJobs: [{ status: "done", createdAt: at(2), updatedAt: at(8), latencyMs: 3000, queueWaitMs: 1000 }] },
});
const logs = [{ id: "r", event: "browser_ready", createdAt: at(15) }, { id: "o", event: "browser_observed", createdAt: at(25) }];
describe("read-only comment evidence timing", () => {
  it("separates elapsed since ingest from adjacent stage intervals", () => {
    const data = buildCommentEvidence(fixture(), { evaluation: { state: "matched", evaluatedAt: at(10) }, logs, totalLogs: 2, account: { id: "42", name: "เจ้าของ" }, now: at(30) });
    expect(data.stages.find(s => s.key === "dispatch")).toMatchObject({ elapsedFromIngestMs: 20000, waitFromPreviousMs: 5000 });
    expect(data.stages.find(s => s.key === "observed")).toMatchObject({ elapsedFromIngestMs: 25000, waitFromPreviousMs: 5000 });
    expect(data.commentUrl).toBeNull(); // Extension currently does not persist the observed URL.
    expect(data.account).toEqual({ id: "42", name: "เจ้าของ" });
  });
  it("does not turn missing stages, negative intervals or future clocks into zero", () => {
    const job = fixture(); job.post.aiJobs = []; job.createdAt = at(-5); job.dispatchedAt = at(40);
    const data = buildCommentEvidence(job, { evaluation: { state: "matched", evaluatedAt: at(10) }, logs: [], totalLogs: 0, account: null, now: at(30) });
    expect(data.ai).toBeNull();
    expect(data.stages.find(s => s.key === "queued")).toMatchObject({ waitFromPreviousMs: null, timing: "out_of_order" });
    expect(data.stages.find(s => s.key === "dispatch")).toMatchObject({ at: null, elapsedFromIngestMs: null, timing: "future" });
    expect(data.stages.find(s => s.key === "observed")?.at).toBeNull();
  });
  it("returns only explicit safe fields even when records contain credentials and raw log messages", () => {
    const job = { ...fixture(), claimToken: "SECRET", generation: "SECRET", browserDeviceId: "SECRET", lastError: "SECRET" };
    const data = buildCommentEvidence(job, { logs: [{ ...logs[0], message: "SECRET", eventKey: "SECRET" }], totalLogs: 101, account: null, now: at(30) });
    expect(JSON.stringify(data)).not.toContain("SECRET");
    expect(data.coverage).toMatchObject({ totalLogs: 101, returnedLogs: 1, truncated: true });
  });
});
describe("safe evidence links", () => {
  it("strips tracking and rejects malformed, credentialed, foreign or wrong target URLs", () => {
    expect(safeEvidenceTarget(fixture())).toBe("https://www.facebook.com/groups/test/posts/123/");
    for (const externalUrl of ["javascript:alert(1)", "https://evil.test/groups/test/posts/123/", "https://user:password@www.facebook.com/groups/test/posts/123/", "https://www.facebook.com/groups/test/posts/999/"]) {
      expect(safeEvidenceTarget({ ...fixture(), externalUrl })).toBeNull();
    }
  });
});
it("links only persisted numeric receipts on observed extension jobs", () => {
  const options = { logs, totalLogs: 2, account: null, now: at(30) };
  const job = { ...fixture(), remoteCommentId: "987" };
  expect(buildCommentEvidence(job, options).commentUrl).toBe("https://www.facebook.com/groups/test/posts/123/?comment_id=987");
  expect(buildCommentEvidence({ ...job, status: "uncertain" }, options).commentUrl).toBeNull();
  expect(buildCommentEvidence({ ...job, remoteCommentId: "999_987" }, options).commentUrl).toBeNull();
  expect(buildCommentEvidence({ ...job, remoteCommentId: "javascript:bad" }, options).commentUrl).toBeNull();
});
it("keeps all durations unknown for an out-of-order stage", () => {
  const job = { ...fixture(), createdAt: at(17) };
  const data = buildCommentEvidence(job, { evaluation: { state: "matched", evaluatedAt: at(10) }, logs, totalLogs: 2, account: null, now: at(30) });
  expect(data.stages.find(s => s.key === "ready")).toMatchObject({ timing: "out_of_order", elapsedFromIngestMs: null, waitFromPreviousMs: null });
  expect(data.stages.find(s => s.key === "dispatch")?.waitFromPreviousMs).toBeNull();
});
it("does not echo arbitrary log event strings as evidence", () => {
  const data = buildCommentEvidence(fixture(), { logs: [{ id: "log", event: "SECRET", createdAt: at(1) }], totalLogs: 1, account: null, now: at(30) });
  expect(JSON.stringify(data)).not.toContain("SECRET");
});
it("accepts a learned numeric group alias only with the matching source record", () => {
  const job = { ...fixture(), externalUrl: "https://www.facebook.com/groups/456/posts/123/" };
  expect(safeEvidenceTarget(job)).toBeNull();
  expect(safeEvidenceTarget(job, { type: "facebook_group", url: "https://www.facebook.com/groups/test/", fbGroupId: "456" })).toBe("https://www.facebook.com/groups/456/posts/123/");
  expect(safeEvidenceTarget(job, { type: "facebook_group", url: "https://www.facebook.com/groups/other/", fbGroupId: "456" })).toBeNull();
});

it("keeps latest AI/evaluation snapshots from breaking the delivery stage intervals", () => {
  const job = fixture(); job.post.aiJobs[0].updatedAt = at(29);
  const data = buildCommentEvidence(job, { evaluation: { state: "matched", evaluatedAt: at(28) }, logs, totalLogs: 2, account: null, now: at(30) });
  expect(data.stages.find(s => s.key === "queued")).toMatchObject({ timing: "recorded", elapsedFromIngestMs: 12000 });
  expect(data.stages.find(s => s.key === "ready")).toMatchObject({ waitFromPreviousMs: 3000 });
  expect(data.ai?.recordUpdatedAt).toBe("2026-11-12T00:00:29.000Z");
  expect(data.evaluation?.evaluatedAt).toBe("2026-11-12T00:00:28.000Z");
});
