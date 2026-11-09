import { afterEach, expect, it, vi } from "vitest";
import { classifyLeads, classifyAvailability } from "../../src/lib/ai/run";
import type { AppSettings } from "../../src/lib/settings";
afterEach(() => vi.unstubAllGlobals());
it.each(["auto", "ollama", "groq", "gemini", "rules"])("classifies locally despite legacy %s settings and ignores model cache", async (aiProvider) => {
    const network = vi.fn(() => { throw Error("No model traffic allowed"); });
    vi.stubGlobal("fetch", network);
    const cache = { get: vi.fn(async () => ({ id: "p", intent: "seller" })), set: vi.fn() };
    const settings = { aiProvider } as AppSettings;
    const result = await classifyLeads([{ id: "p", text: "หาซื้อไอแพดมือสอง งบ 5000 บาท" }], [], settings, cache as never);
    expect(result.providersById.p).toBe("rules");
    expect(result.results[0].intent).toBe("buyer");
    expect(cache.get).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(await classifyAvailability(settings)).toMatchObject({ rulesOnly: true, names: ["rules"], nextReadyAt: null });
});
