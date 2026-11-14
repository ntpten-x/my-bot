import { afterEach, describe, expect, it } from "vitest";
import { bootstrapTokenErrorMessage, bootstrapTokenOk } from "../../src/lib/bootstrap-token";

const h = (values: Record<string, string>) => new Headers(values);

describe("bootstrapTokenOk", () => {
  const prev = process.env.BOOTSTRAP_TOKEN;

  afterEach(() => {
    if (prev === undefined) delete process.env.BOOTSTRAP_TOKEN;
    else process.env.BOOTSTRAP_TOKEN = prev;
  });

  it("allows unconfigured development setup on localhost", () => {
    process.env.BOOTSTRAP_TOKEN = "";
    const request = new Request("http://localhost:8001/api/auth/setup", {
      headers: h({ host: "localhost:8001" }),
    });
    expect(bootstrapTokenOk(request, "")).toBe(true);
    expect(bootstrapTokenOk(request, undefined)).toBe(true);
  });

  it("requires a matching cloud token of at least 24 bytes", () => {
    process.env.BOOTSTRAP_TOKEN = "cloud-bootstrap-token-ok-32chars!!";
    const request = new Request("https://mb-agcf.onrender.com/api/auth/reset-password", {
      headers: h({ host: "mb-agcf.onrender.com", "x-forwarded-proto": "https" }),
    });
    expect(bootstrapTokenOk(request, "cloud-bootstrap-token-ok-32chars!!")).toBe(true);
    expect(bootstrapTokenOk(request, "wrong-token")).toBe(false);
    expect(bootstrapTokenOk(request, "")).toBe(false);
  });

  it("rejects a short cloud env token even if the given value matches", () => {
    process.env.BOOTSTRAP_TOKEN = "too-short";
    const request = new Request("https://mb-agcf.onrender.com/api/auth/setup", {
      headers: h({ host: "mb-agcf.onrender.com", "x-forwarded-proto": "https" }),
    });
    expect(bootstrapTokenOk(request, "too-short")).toBe(false);
  });

  it("exposes a stable Thai error message", () => {
    expect(bootstrapTokenErrorMessage()).toContain("รหัสตั้งระบบครั้งแรก");
  });
});
