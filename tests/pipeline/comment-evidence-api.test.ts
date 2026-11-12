import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authed: vi.fn(), job: vi.fn(), logs: vi.fn(), first: vi.fn(), count: vi.fn(), evaluation: vi.fn(), account: vi.fn(), source: vi.fn() }));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.authed }));
vi.mock("../../src/lib/prisma", () => ({ prisma: {
  autoCommentJob: { findUnique: mocks.job }, autoCommentLog: { findMany: mocks.logs, findFirst: mocks.first, count: mocks.count },
  autoCommentEvaluation: { findUnique: mocks.evaluation }, fbAccount: { findUnique: mocks.account }, source: { findUnique: mocks.source },
} }));
import { GET } from "../../src/app/api/auto-comment/jobs/[id]/evidence/route";
const request = new Request("http://localhost/api/auto-comment/jobs/job/evidence");
const context = (id = "job") => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.authed.mockResolvedValue({ error: null });
  mocks.logs.mockResolvedValue([]); mocks.first.mockResolvedValue(null); mocks.count.mockResolvedValue(0);
  mocks.source.mockResolvedValue(null); mocks.evaluation.mockResolvedValue(null); mocks.account.mockResolvedValue(null);
});
it("rejects unauthenticated reads before database access", async () => {
  mocks.authed.mockResolvedValue({ error: new Response("unauthorized", { status: 401 }) });
  expect((await GET(request, context())).status).toBe(401); expect(mocks.job).not.toHaveBeenCalled();
});
it("rejects malformed ids and returns 404 for missing jobs", async () => {
  expect((await GET(request, context("../x"))).status).toBe(400); expect(mocks.job).not.toHaveBeenCalled();
  mocks.job.mockResolvedValue(null); expect((await GET(request, context())).status).toBe(404);
});
it("bounds log reads and strips sensitive fields even from an oversized database record", async () => {
  const date = new Date("2026-01-01T00:00:00Z");
  mocks.job.mockResolvedValue({ id: "job", postId: "post", postKey: "group:test:123", externalUrl: "https://www.facebook.com/groups/test/posts/123/?access_token=SECRET", sourceId: "source", pageId: "", deliveryMode: "extension", browserFbUserId: "42", message: "ข้อความที่เตรียม", status: "uncertain", dryRun: false, attempts: 1, createdAt: date, dispatchedAt: date, remoteCommentId: null, post: null, generation: "SECRET", claimToken: "SECRET", lastError: "SECRET" });
  mocks.logs.mockResolvedValue([{ id: "log", event: "uncertain", createdAt: date, message: "SECRET", eventKey: "SECRET" }]); mocks.count.mockResolvedValue(101);
  const response = await GET(request, context()); const body = await response.json();
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(JSON.stringify(body)).not.toContain("SECRET");
  expect(body.targetUrl).toBe("https://www.facebook.com/groups/test/posts/123/");
  expect(body.coverage.truncated).toBe(true);
  expect(mocks.logs.mock.calls[0][0]).toMatchObject({ where: { jobId: "job" }, take: 100, select: { id: true, event: true, createdAt: true } });
  expect(mocks.count.mock.calls[0][0]).toEqual({ where: { jobId: "job" } });
  expect(mocks.evaluation.mock.calls[0][0].where).toEqual({ generation_postId: { generation: "SECRET", postId: "post" } });
  const select = mocks.job.mock.calls[0][0].select;
  for (const field of ["claimToken", "browserDeviceId", "lastError", "imagePath"]) expect(select[field]).toBeUndefined();
});
it("does not leak database exceptions", async () => {
  mocks.job.mockRejectedValue(new Error("SECRET"));
  const response = await GET(request, context()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("SECRET");
});
