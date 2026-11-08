import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), register: vi.fn() }));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.auth }));
vi.mock("../../src/lib/extension-devices", () => ({ registerExtensionHash: mocks.register }));
vi.mock("../../src/lib/auth", () => ({ clientIp: () => "127.0.0.1" }));
import { POST } from "../../src/app/api/extension-devices/connect/route";
const fingerprint = { tokenHash: "a".repeat(64), tokenHint: "mbd_…abcd", name: "Synthetic Chrome" };
const request = (origin = "https://owner.example", body: object = fingerprint) => new Request("https://owner.example/api/extension-devices/connect", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ session: { id: "owner-session" }, error: null }); mocks.register.mockResolvedValue({ deviceId: "device" }); });
it("enrolls only a hash from an authenticated same-origin request and never returns a credential", async () => {
  const result = await POST(request());
  expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
  expect(await result.json()).toEqual({ ok: true, deviceId: "device" });
  expect(mocks.register).toHaveBeenCalledWith(fingerprint.tokenHash, fingerprint.tokenHint, fingerprint.name, "127.0.0.1");
});
it("rejects cross-origin, missing Origin and unauthenticated registration", async () => {
  for (const origin of ["https://evil.example", "null", ""]) expect((await POST(request(origin))).status).toBe(403);
  expect(mocks.register).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValue({ error: Response.json({ error: "login" }, { status: 401 }) });
  expect((await POST(request())).status).toBe(401); expect(mocks.register).not.toHaveBeenCalled();
});
it("rejects credentials in the body and does not reactivate a revoked device", async () => {
  expect((await POST(request(undefined, { ...fingerprint, token: "mbd_forbidden" }))).status).toBe(400);
  expect(mocks.register).not.toHaveBeenCalled();
  mocks.register.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(403);
});
it("does not expose database/provider exceptions", async () => {
  mocks.register.mockRejectedValue(new Error("synthetic-internal-private-value"));
  const result = await POST(request()); expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("synthetic-internal-private-value");
});
