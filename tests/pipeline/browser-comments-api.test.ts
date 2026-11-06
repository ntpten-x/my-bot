import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), claim: vi.fn(), authorize: vi.fn(), report: vi.fn() }));
vi.mock("../../src/lib/extension-devices", () => ({ verifyDeviceToken: mocks.verify }));
vi.mock("../../src/lib/auto-comment/browser", () => ({ claimBrowserComment: mocks.claim, authorizeBrowserComment: mocks.authorize, reportBrowserComment: mocks.report }));
import { POST } from "../../src/app/api/v1/extension/comments/route";
const request = (body: unknown, url = "https://owner.example/api/v1/extension/comments") => new Request(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer mbd_synthetic" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockResolvedValue("paired-device"); });
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
