import { afterEach, expect, it, vi } from "vitest";
vi.mock("node:fs", () => ({ existsSync: (file: string) => file !== ".env", readFileSync: () => "" }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { $queryRaw: async () => [], source: { count: async () => 0 } } }));
vi.mock("../../src/lib/settings", () => ({ getSettings: async () => null }));
vi.mock("../../src/lib/ai/ollama-url", () => ({ resolveOllamaBaseUrl: vi.fn() }));
vi.mock("../../src/lib/smart/embed", () => ({ testEmbedding: vi.fn() }));
import { collectDoctorReport } from "../../src/lib/doctor-run";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("recognizes Render process environment without requiring a .env file", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic:synthetic@localhost:5432/synthetic");
  vi.stubEnv("DIRECT_URL", "postgresql://synthetic:synthetic@localhost:5432/synthetic");
  vi.stubEnv("PORT", "8001"); vi.stubEnv("GROQ_API_KEY", "synthetic-test-key");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ needsSetup: false }))));
  const result = await collectDoctorReport();
  expect(result.checks.find(check => check.id === "env-db")?.status).toBe("PASS");
  expect(result.checks.find(check => check.id === "env-direct")?.status).not.toBe("FAIL");
  expect(result.checks.find(check => check.id === "env-port")?.status).toBe("PASS");
  expect(JSON.stringify(result)).not.toContain("synthetic-test-key");
});
