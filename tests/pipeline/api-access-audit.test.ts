import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, has: () => false }), headers: async () => new Headers() }));
vi.mock("../../src/lib/prisma", () => {
  const query = () => { throw Error("Unauthenticated handler attempted database access"); };
  return { prisma: new Proxy({}, { get: (_target, name) => String(name).startsWith("$") ? query : new Proxy({}, { get: () => query }) }) };
});
// Bad-token telemetry is deliberately best effort and carries no app data.
vi.mock("../../src/lib/extension-heartbeat", async importOriginal => ({ ...await importOriginal<object>(), noteBadExtensionToken: async () => undefined }));
const modules = import.meta.glob("../../src/app/api/**/route.ts");
const publicRoutes = new Set(["auth/status", "auth/login", "auth/setup", "auth/reset-password", "auth/logout", "health", "v1/health", "v1/extension/pair"]);
const network = vi.fn(() => { throw Error("Outbound network forbidden in access audit"); });
beforeAll(() => vi.stubGlobal("fetch", network));
afterAll(() => vi.unstubAllGlobals());
for (const [file, load] of Object.entries(modules)) {
  const path = file.split("/api/")[1].replace(/\/route.ts$/, "");
  if (publicRoutes.has(path)) continue;
  it(`denies anonymous callers before data access: /api/${path}`, async () => {
    const handlers = await load() as Record<string, (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> | Response>;
    let checked = 0;
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      if (typeof handlers[method] !== "function") continue;
      const url = `http://localhost:8001/api/${path.replaceAll("[id]", "synthetic-id")}`;
      const request = new Request(url, { method, headers: { origin: "http://localhost:8001", "content-type": "application/json" }, ...(!["GET", "HEAD"].includes(method) ? { body: "{}" } : {}) });
      const response = await handlers[method](request, { params: Promise.resolve({ id: "synthetic-id" }) });
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(await response.text()).not.toMatch(/passwordHash|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|sha256:/);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    expect(network).not.toHaveBeenCalled();
  });
}
