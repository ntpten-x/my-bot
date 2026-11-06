import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authed: vi.fn(), schema: vi.fn(), lease: vi.fn(), settings: vi.fn(), devices: vi.fn(), accounts: vi.fn(), sources: vi.fn(), providers: vi.fn(), counts: vi.fn() }));
vi.mock("../../src/lib/schema-readiness", () => ({ schemaReadiness: mocks.schema }));
vi.mock("../../src/lib/prisma", () => ({ prisma: {
  lease: { findUnique: mocks.lease }, setting: { findMany: mocks.settings }, extensionDevice: { findMany: mocks.devices },
  fbAccount: { findMany: mocks.accounts }, source: { findMany: mocks.sources }, aiProvider: { findMany: mocks.providers }, autoCommentJob: { groupBy: mocks.counts },
} }));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.authed }));
vi.mock("../../src/lib/auto-comment/control", () => ({ readCommentControl: async () => ({ state: "stopped", dryRun: true }) }));
vi.mock("../../src/lib/coverage-data", () => ({ coverageBySource: async () => new Map() }));
import { GET } from "../../src/app/api/automation-readiness/route";
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("AI_KEY_SECRET", "synthetic-readiness-secret"); vi.stubEnv("GEMINI_API_KEY", ""); vi.stubEnv("GROQ_API_KEY", "");
  mocks.authed.mockResolvedValue({ error: null }); mocks.lease.mockResolvedValue(null); mocks.settings.mockResolvedValue([]);
  mocks.schema.mockResolvedValue({ ready: true, missing: [] });
  mocks.devices.mockResolvedValue([]); mocks.accounts.mockResolvedValue([]); mocks.sources.mockResolvedValue([]); mocks.providers.mockResolvedValue([]); mocks.counts.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
it("requires a session before checking infrastructure", async () => {
  mocks.authed.mockResolvedValue({ error: new Response(null, { status: 401 }) }); expect((await GET()).status).toBe(401); expect(mocks.settings).not.toHaveBeenCalled();
});
it("never returns stored secrets and explains missing infrastructure", async () => {
  mocks.settings.mockResolvedValue([{ key: "groq_api_key", value: "synthetic-sensitive-value" }]);
  const response = await GET(), text = await response.text(); expect(text).not.toContain("synthetic-sensitive-value");
  const result = JSON.parse(text); expect(result.legacySecrets).toBe(1);
  expect(result.steps.find((step: { key: string }) => step.key === "secret").ready).toBe(false);
  expect(result.steps.find((step: { key: string }) => step.key === "worker").ready).toBe(false);
  expect(result.steps.find((step: { key: string }) => step.key === "extension").ready).toBe(false);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("uses fresh per-device runtime for account and local comment opt-in", async () => {
  mocks.devices.mockResolvedValue([{ id: "device", name: "Chrome", lastSeenAt: new Date() }]);
  mocks.settings.mockResolvedValue([{ key: "extension_runtime_device", value: JSON.stringify({ at: new Date().toISOString(), fbUserId: "99887766", commentsEnabled: true, quietReason: "หน้าจอล็อกอยู่" }) }]);
  const result = await (await GET()).json(); expect(result.extensions[0]).toMatchObject({ online: true, commentsEnabled: true, fbUserId: "99887766", quietReason: "หน้าจอล็อกอยู่" });
  expect(result.steps.find((step: { key: string }) => step.key === "comments").ready).toBe(true);
});
it("redacts infrastructure errors", async () => {
  mocks.settings.mockRejectedValue(new Error("synthetic-secret-url")); const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("synthetic-secret-url");
});
it("reports missing migrations before querying incomplete application tables", async () => {
  mocks.schema.mockResolvedValue({ ready: false, missing: ["Post.textRevision"] });
  const response = await GET(); expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "SCHEMA_NOT_READY", schema: { missing: ["Post.textRevision"] } });
  expect(mocks.settings).not.toHaveBeenCalled();
});
