import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../../src/lib/auth", () => ({ getSession: mocks.session }));
import { authed } from "../../src/lib/guard";
afterEach(() => vi.unstubAllEnvs());
it("requires MFA for business APIs after coordinated rollout and allows only enrollment routes", async () => {
  vi.stubEnv("SECURITY_RELEASE_READY", "1"); vi.stubEnv("SECURITY_REQUIRE_MFA", "1");
  mocks.session.mockResolvedValue({ mfaEnabled: false, authenticatedAt: new Date() });
  expect((await authed()).error?.status).toBe(403);
  expect((await authed({ allowMfaSetup: true })).error).toBeNull();
  mocks.session.mockResolvedValue({ mfaEnabled: true, authenticatedAt: new Date() });
  expect((await authed({ recent: true })).error).toBeNull();
});
