import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authed: vi.fn(), update: vi.fn(), save: vi.fn(), dashboard: vi.fn() }));
vi.mock("../../src/lib/schema-readiness", () => ({ schemaReadiness: async () => ({ ready: true }) }));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.authed }));
vi.mock("../../src/lib/auto-comment/control", () => ({ updateCommentControl: mocks.update }));
vi.mock("../../src/lib/auto-comment/admin", async importOriginal => ({ ...await importOriginal<typeof import("../../src/lib/auto-comment/admin")>(), saveCommentRule: mocks.save }));
vi.mock("../../src/lib/auto-comment/engine", () => ({ autoCommentDashboard: mocks.dashboard }));
import { GET, PUT } from "../../src/app/api/auto-comment/route";
import { POST } from "../../src/app/api/auto-comment/rules/route";
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost:8001/api/auto-comment", { method: "PUT", headers: { "content-type": "application/json", origin: "http://localhost:8001", ...headers }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.authed.mockResolvedValue({ error: null }); });
describe("auto comment authenticated control API", () => {
  it("requires a session for reading, creating rules and changing global state", async () => {
    mocks.authed.mockImplementation(async () => ({ error: new Response("unauthorized", { status: 401 }) }));
    expect((await GET(new Request("http://localhost/api/auto-comment"))).status).toBe(401); expect((await PUT(request({ action: "start" }))).status).toBe(401); expect((await POST(request({}))).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.dashboard).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and simple form requests before mutation", async () => {
    expect((await PUT(request({ action: "start" }, { origin: "https://untrusted.test" }))).status).toBe(403);
    expect((await PUT(request({ action: "start" }, { "content-type": "text/plain" }))).status).toBe(415);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("validates quotas and rejects invalid rules before storage", async () => {
    expect((await PUT(request({ hourlyLimit: 9999 }))).status).toBe(400);
    expect((await POST(request({ name: "missing templates" }))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("never echoes storage exceptions that may contain credentials", async () => {
    mocks.save.mockRejectedValue(new Error("SYNTHETIC_SECRET_DO_NOT_ECHO"));
    const result = await POST(request({ name: "ทดสอบ", pageId: "12345", templates: ["test"], pageToken: "SYNTHETIC_SECRET_DO_NOT_ECHO" }));
    expect(result.status).toBe(400); expect(await result.text()).not.toContain("SYNTHETIC_SECRET_DO_NOT_ECHO");
  });
  it("passes valid Stop commands to serialized controller", async () => {
    mocks.update.mockResolvedValue({ state: "stopped" }); const result = await PUT(request({ action: "stop" }));
    expect(result.status).toBe(200); expect(mocks.update).toHaveBeenCalledWith({ action: "stop", dryRun: false, liveAcknowledged: true, liveOnly: true });
  });
});

it("rejects simulation requests and starts only the live workflow", async () => {
  expect((await PUT(request({ dryRun: true }))).status).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
  mocks.update.mockResolvedValue({ state: "running", dryRun: false });
  expect((await PUT(request({ action: "start" }))).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith({ action: "start", dryRun: false, liveAcknowledged: true, liveOnly: true });
});

it("presents legacy simulated runs as stopped without changing stored state or starting work", async () => {
  const legacy = { control: { state: "running", dryRun: true }, rules: [] };
  mocks.dashboard.mockResolvedValue(legacy);
  const result = await GET(new Request("http://localhost/api/auto-comment"));
  expect(result.status).toBe(200);
  expect((await result.json()).control).toMatchObject({ state: "stopped", dryRun: false });
  expect(legacy.control).toEqual({ state: "running", dryRun: true });
  expect(mocks.update).not.toHaveBeenCalled();
});
