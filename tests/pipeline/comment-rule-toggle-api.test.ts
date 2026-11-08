import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), toggle: vi.fn(), remove: vi.fn() }));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.auth }));
vi.mock("../../src/lib/auto-comment/admin", async original => ({ ...await original<typeof import("../../src/lib/auto-comment/admin")>(), setCommentRuleEnabled: mocks.toggle, deleteCommentRule: mocks.remove }));
import { PATCH, DELETE } from "../../src/app/api/auto-comment/rules/[id]/route";
import { RuleToggleError } from "../../src/lib/auto-comment/admin";
const request = (body: unknown, headers = {}) => new Request("http://localhost:8001/api/auto-comment/rules/rule", { method: "PATCH", headers: { "content-type": "application/json", origin: "http://localhost:8001", ...headers }, body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: "rule" }) };
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({}); mocks.remove.mockResolvedValue({ ok: true }); mocks.toggle.mockResolvedValue({ id: "rule", enabled: false, revision: 3 }); });
it("requires an owner session, same origin and JSON", async () => {
  mocks.auth.mockResolvedValueOnce({ error: new Response(null, { status: 401 }) });
  expect((await PATCH(request({}), context)).status).toBe(401);
  expect((await PATCH(request({}, { origin: "https://other.test" }), context)).status).toBe(403);
  expect((await PATCH(request({}, { "content-type": "text/plain" }), context)).status).toBe(415);
  expect(mocks.toggle).not.toHaveBeenCalled();
});
it("changes only the requested rule using its expected revision", async () => {
  expect((await PATCH(request({ enabled: false, revision: 2 }), context)).status).toBe(200);
  expect(mocks.toggle).toHaveBeenCalledWith("rule", false, 2);
});
it.each([{ enabled: true }, { enabled: "true", revision: 1 }, { enabled: true, revision: 1, templates: ["replace"] }])("rejects incomplete or overbroad toggles %j", async body => {
  expect((await PATCH(request(body), context)).status).toBe(400); expect(mocks.toggle).not.toHaveBeenCalled();
});
it("reports validation conflicts but hides storage failures", async () => {
  mocks.toggle.mockRejectedValueOnce(new RuleToggleError("กรุณารีเฟรชรายการ", 409));
  const conflict = await PATCH(request({ enabled: true, revision: 1 }), context); expect(conflict.status).toBe(409);
  mocks.toggle.mockRejectedValueOnce(new Error("SYNTHETIC_SECRET"));
  const failure = await PATCH(request({ enabled: true, revision: 1 }), context); expect(failure.status).toBe(503); expect(await failure.text()).not.toContain("SYNTHETIC_SECRET");
});

it("validates and authorizes deletion before calling the archive operation", async () => {
  mocks.auth.mockResolvedValueOnce({ error: new Response(null, { status: 401 }) });
  expect((await DELETE(request({ revision: 2 }), context)).status).toBe(401);
  expect((await DELETE(request({}), context)).status).toBe(400);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect((await DELETE(request({ revision: 2 }), context)).status).toBe(200);
  expect(mocks.remove).toHaveBeenCalledWith("rule", 2);
});
