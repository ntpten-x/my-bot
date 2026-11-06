import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  registry: vi.fn(), health: vi.fn(), ollama: vi.fn(), gemini: vi.fn(), groq: vi.fn(),
}));
vi.mock("../../src/lib/ai/provider-registry", () => ({ routedClassifyAttempts: deps.registry }));
vi.mock("../../src/lib/ai/health", () => ({ selectReadyProviders: deps.health }));
vi.mock("../../src/lib/ai/providers", () => ({ ollamaClassify: deps.ollama, geminiClassify: deps.gemini, groqClassify: deps.groq }));
import { classifyLeads } from "../../src/lib/ai/run";
import type { AppSettings } from "../../src/lib/settings";

const settings = { aiProvider: "auto" } as AppSettings;
const posts = [{ id: "p", text: "ตามหาไอแพดมือสอง" }];
beforeEach(() => vi.resetAllMocks());
describe("auto provider compatibility and failover", () => {
  it("uses legacy env keys when the registry is empty, even without a master secret", async () => {
    deps.registry.mockResolvedValue(null);
    deps.health.mockResolvedValue({ ready: ["gemini"], errors: [] });
    deps.gemini.mockResolvedValue([{ id: "p", intent: "buyer" }]);
    expect((await classifyLeads(posts, [], settings)).providersById.p).toBe("gemini");
    expect(deps.health).toHaveBeenCalledWith(["ollama", "gemini", "groq"], settings);
  });
  it("appends newly configured env presets without bypassing disabled registry presets", async () => {
    deps.registry.mockResolvedValue({ providers: [], managedPresets: ["ollama", "gemini"], errors: [] });
    deps.health.mockResolvedValue({ ready: ["groq"], errors: [] });
    deps.groq.mockResolvedValue([{ id: "p", intent: "buyer" }]);
    expect((await classifyLeads(posts, [], settings)).providersById.p).toBe("groq");
    expect(deps.health).toHaveBeenCalledWith(["groq"], settings);
    expect(deps.gemini).not.toHaveBeenCalled();
  });
  it("fails over after a registry provider failure, retaining per-post provenance", async () => {
    const first = vi.fn(async () => { throw new Error("HTTP 503"); });
    deps.registry.mockResolvedValue({ providers: [{ name: "custom", classify: first }], managedPresets: ["ollama"], errors: [] });
    deps.health.mockResolvedValue({ ready: ["groq"], errors: [] });
    deps.groq.mockResolvedValue([{ id: "p", intent: "buyer" }]);
    const out = await classifyLeads(posts, [], settings);
    expect(out.providersById.p).toBe("groq");
    expect(out.errors[0].message).toBe("HTTP 503");
  });
});
