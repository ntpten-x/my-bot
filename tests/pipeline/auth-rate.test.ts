import { afterEach, expect, it, vi } from "vitest";
import { authRateError, requestIdentity } from "../../src/lib/auth-rate";
afterEach(() => vi.unstubAllEnvs());
it("ignores untrusted forwarded identities and selects only the explicitly trusted proxy hop", () => {
  const request = (ip: string) => new Request("https://synthetic.invalid", { headers: { "x-forwarded-for": ip } });
  vi.stubEnv("TRUST_PROXY_HOPS", "0");
  expect(requestIdentity(request("1.1.1.1"))).toBe(requestIdentity(request("8.8.8.8")));
  vi.stubEnv("TRUST_PROXY_HOPS", "1");
  expect(requestIdentity(request("1.1.1.1, 8.8.8.8"))).toBe(requestIdentity(request("8.8.8.8")));
});
it("bounds auth traffic before database work, including spoofed client addresses", () => {
  vi.stubEnv("TRUST_PROXY_HOPS", "0"); const now = Date.now() + 100000;
  const request = new Request("https://synthetic.invalid");
  for (let i = 0; i < 20; i++) expect(authRateError(request, now)).toBeNull();
  expect(authRateError(request, now)?.status).toBe(429);
  expect(authRateError(request, now + 60001)).toBeNull();
});
