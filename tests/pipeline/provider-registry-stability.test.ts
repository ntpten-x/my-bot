import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ count: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), reachable: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { aiProvider: { count: db.count, createMany: db.createMany, findMany: db.findMany } } }));
vi.mock("../../src/lib/ai/ollama-url", () => ({ ollamaReachable: db.reachable, resolveOllamaBaseUrl: vi.fn(), OLLAMA_KEEP_ALIVE: "30m" }));
import { routedClassifyAttempts } from "../../src/lib/ai/provider-registry";
import type { AppSettings } from "../../src/lib/settings";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const settings = { ollamaBaseUrl: "http://127.0.0.1:11434", geminiApiKey: "fake-unit-key" } as AppSettings;
describe("registry bootstrap and host reachability", () => {
  it("does not seed an Ollama-only registry when secrets cannot be encrypted", async () => {
    vi.stubEnv("AI_KEY_SECRET", ""); db.findMany.mockResolvedValue([]);
    expect(await routedClassifyAttempts(settings)).toBeNull();
    expect(db.createMany).not.toHaveBeenCalled();
  });
  it("checks each Ollama endpoint and preserves disabled presets without env fallback", async () => {
    vi.stubEnv("AI_KEY_SECRET", "");
    const row = { id: "local", preset: "ollama", kind: "ollama", name: "local", baseUrl: "http://127.0.0.1:41434", enabled: true, tasks: "classify", priority: 10, limitPerMinute: null, limitPerDay: null, cooldownUntil: null, usageDay: null, requestsToday: 0, resetHourUtc: 0 };
    db.findMany.mockResolvedValue([row, { ...row, id: "disabled", preset: "gemini", kind: "gemini", enabled: false }]);
    db.reachable.mockResolvedValue(false);
    const result = await routedClassifyAttempts(settings);
    expect(result?.providers).toEqual([]);
    expect(result?.managedPresets).toEqual(["ollama", "gemini"]);
    expect(db.reachable).toHaveBeenCalledWith("http://127.0.0.1:41434");
    expect(db.createMany).not.toHaveBeenCalled();
  });
});
