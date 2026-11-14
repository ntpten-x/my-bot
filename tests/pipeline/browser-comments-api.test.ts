import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), claim: vi.fn(), authorize: vi.fn(), report: vi.fn(), allowed: vi.fn(), retry: vi.fn() }));
vi.mock("../../src/lib/facebook-accounts", () => ({ facebookWorkAllowed: mocks.allowed }));
vi.mock("../../src/lib/extension-devices", () => ({ verifyDeviceToken: mocks.verify }));
vi.mock("../../src/lib/auto-comment/browser", () => ({ browserCommentRetryAfterMs: mocks.retry, claimBrowserComment: mocks.claim, authorizeBrowserComment: mocks.authorize, reportBrowserComment: mocks.report }));
import { EXPECTED_EXTENSION_VERSION } from "../../src/lib/extension-heartbeat";
import { POST } from "../../src/app/api/v1/extension/comments/route";
const request = (body: unknown, url = "https://owner.example/api/v1/extension/comments") => new Request(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer mbd_synthetic", "x-extension-version": EXPECTED_EXTENSION_VERSION }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockResolvedValue("paired-device"); mocks.allowed.mockResolvedValue(true); mocks.retry.mockResolvedValue(17000); });
it("requires secure transport and a device token, not an owner cookie", async () => {
  expect((await POST(request({ action: "claim", fbUserId: "99887766" }, "http://owner.example/api/v1/extension/comments"))).status).toBe(403);
  mocks.verify.mockResolvedValue(null); expect((await POST(request({ action: "claim", fbUserId: "99887766" }))).status).toBe(401); expect(mocks.claim).not.toHaveBeenCalled();
});
it("validates actions and binds the claimed device server-side", async () => {
  expect((await POST(request({ action: "claim", fbUserId: "99887766", deviceId: "other" }))).status).toBe(400);
  mocks.claim.mockResolvedValue(null); const response = await POST(request({ action: "claim", fbUserId: "99887766" }));
  expect(response.status).toBe(200); expect(mocks.claim).toHaveBeenCalledWith("paired-device", "99887766"); expect(response.headers.get("cache-control")).toBe("no-store");
});
it("redacts exceptions without exposing tokens or bodies", async () => {
  mocks.claim.mockRejectedValue(new Error("synthetic-secret")); const response = await POST(request({ action: "claim", fbUserId: "99887766" }));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("synthetic-secret");
});

it("blocks new claims and grants for paused accounts while allowing reports", async () => {
  mocks.allowed.mockResolvedValue(false);
  const claim = await POST(request({ action: "claim", fbUserId: "99887766" }));
  expect(await claim.json()).toEqual({ job: null, accountPaused: true }); expect(mocks.claim).not.toHaveBeenCalled();
  const claimToken = "12345678-1234-4234-8234-123456789012";
  const grant = await POST(request({ action: "authorize", id: "job-1", claimToken, fbUserId: "99887766" }));
  expect(await grant.json()).toEqual({ grant: null, accountPaused: true }); expect(mocks.authorize).not.toHaveBeenCalled();
  mocks.report.mockResolvedValue(true);
  expect((await POST(request({ action: "report", id: "job-1", claimToken, outcome: "uncertain" }))).status).toBe(200);
  expect(mocks.report).toHaveBeenCalled();
});
it("requires the current comment protocol for new work but accepts old reports", async () => {
  const outdated = (body: unknown) => new Request("https://owner.example/api/v1/extension/comments", { method: "POST", headers: { authorization: "Bearer mbd_synthetic", "x-extension-version": "1.11.3" }, body: JSON.stringify(body) });
  const response = await POST(outdated({ action: "claim", fbUserId: "99887766" }));
  expect(await response.json()).toMatchObject({ job: null, upgradeRequired: true, expectedVersion: EXPECTED_EXTENSION_VERSION });
  expect(mocks.claim).not.toHaveBeenCalled();
  mocks.report.mockResolvedValue(true);
  expect((await POST(outdated({ action: "report", id: "old", claimToken: "12345678-1234-4234-8234-123456789012", outcome: "uncertain" }))).status).toBe(200);
  expect(mocks.report).toHaveBeenCalled();
});

it("returns a device-bound relative wake hint only after an empty claim", async () => {
  mocks.claim.mockResolvedValue(null);
  expect(await (await POST(request({ action: "claim", fbUserId: "99887766" }))).json()).toEqual({ job: null, retryAfterMs: 17000 });
  expect(mocks.retry).toHaveBeenCalledWith("paired-device", "99887766");
  mocks.retry.mockClear(); mocks.claim.mockResolvedValue({ id: "job" });
  expect(await (await POST(request({ action: "claim", fbUserId: "99887766" }))).json()).toEqual({ job: { id: "job" }, retryAfterMs: null });
  expect(mocks.retry).not.toHaveBeenCalled();
});
