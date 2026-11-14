import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../src/middleware";
import { bootstrapTokenOk } from "../../src/lib/bootstrap-token";
import { isHttpsRequest } from "../../src/lib/request-security";
import { json } from "../../src/lib/http";

// Offline reproductions: synthetic requests only, no network or owner credentials.
afterEach(() => vi.unstubAllEnvs());
it("requires a recovery token even from localhost", () => {
  vi.stubEnv("BOOTSTRAP_TOKEN", "");
  expect(bootstrapTokenOk(new Request("http://localhost:8001/api/auth/reset-password"), "")).toBe(false);
});
it("never treats a spoofed localhost Host as local on a public request URL", () => {
  vi.stubEnv("BOOTSTRAP_TOKEN", "");
  expect(bootstrapTokenOk(new Request("https://public.example/api/auth/setup", { headers: { host: "localhost:8001" } }), "")).toBe(false);
});
it("blocks cross-site and sibling-origin form mutations across all browser APIs", () => {
  for (const path of ["/api/sources", "/api/settings/regenerate-token", "/api/templates/image", "/api/summaries/send"]) {
    for (const site of ["cross-site", "same-site"]) {
      const request = new NextRequest(`https://mybot.example${path}`, { method: "POST", headers: { origin: "https://other.example", "sec-fetch-site": site, "content-type": "text/plain", cookie: "mybot_session=synthetic" }, body: "{}" });
      expect(middleware(request).status).toBe(403);
    }
  }
});
it("does not allow forwarding headers to downgrade a known HTTPS request", () => {
  expect(isHttpsRequest(new Headers({ "x-forwarded-proto": "http" }), "https://mybot.example/api")).toBe(true);
});
it("prevents shared caches from keeping private JSON and blocks framing", () => {
  expect(json({ private: true }).headers.get("cache-control")).toContain("no-store");
  const response = middleware(new NextRequest("https://mybot.example/api/settings"));
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
});

it("uses a fresh CSP nonce and never allows arbitrary inline scripts in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  const first = middleware(new NextRequest("https://mybot.example/login"));
  const second = middleware(new NextRequest("https://mybot.example/login"));
  const policy = first.headers.get("content-security-policy")!;
  const scripts = policy.split(";").find(value => value.includes("script-src"))!;
  expect(scripts).toContain("nonce-"); expect(scripts).toContain("strict-dynamic");
  expect(scripts).not.toContain("unsafe-inline");
  expect(second.headers.get("content-security-policy")).not.toBe(policy);
});
