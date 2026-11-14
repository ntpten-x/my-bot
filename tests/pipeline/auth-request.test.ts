import { afterEach, expect, it, vi } from "vitest";
import { authMutationError } from "../../src/lib/auth-request";
import { authOrigins } from "../../src/lib/auth-origins";
afterEach(() => vi.unstubAllEnvs());
const req = (headers: Record<string, string>) => new Request("https://mybot.example/api/auth/login", { method: "POST", headers });
it("rejects cross-site credentials and form posts before password verification", () => {
  vi.stubEnv("AUTH_URL", "");
  expect(authMutationError(req({ "content-type": "application/json", origin: "https://other.example" }))?.status).toBe(403);
  expect(authMutationError(req({ "content-type": "application/json", "sec-fetch-site": "cross-site" }))?.status).toBe(403);
  expect(authMutationError(req({ "content-type": "text/plain" }))?.status).toBe(415);
  expect(authMutationError(req({ "content-type": "application/json", origin: "https://mybot.example" }))).toBeNull();
  expect(authMutationError(req({ origin: "https://mybot.example" }), false)).toBeNull();
});
it("trusts local aliases only for a local installation, never an arbitrary public host", () => {
  vi.stubEnv("AUTH_URL", "http://localhost:8001");
  expect(authMutationError(new Request("http://127.0.0.1:8001/api/auth/login", { method: "POST", headers: { origin: "http://127.0.0.1:8001", "content-type": "application/json" } }))).toBeNull();
  vi.stubEnv("AUTH_URL", "https://mybot.example");
  expect(authOrigins()).toEqual(["https://mybot.example"]);
  expect(authMutationError(req({ origin: "http://localhost:8001", "content-type": "application/json" }))?.status).toBe(403);
  for (const value of ["http://public.example", "https://user:password@mybot.example", "https://mybot.example/path"]) {
    vi.stubEnv("AUTH_URL", value); expect(() => authOrigins()).toThrow();
  }
});
