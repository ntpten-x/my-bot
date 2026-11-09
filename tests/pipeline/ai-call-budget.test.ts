import { afterEach, expect, it, vi } from "vitest";
import { chatOnce, testProviderRow } from "../../src/lib/ai/provider-registry";
import { ollamaClassify, geminiClassify, groqClassify } from "../../src/lib/ai/providers";
import { embedText } from "../../src/lib/smart/embed";
import { generateCommentDraft } from "../../src/lib/auto-comment/draft";
afterEach(() => vi.unstubAllGlobals());
it("retired transports reject before network access even with explicit credentials", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const row = { kind: "openai", preset: "custom", baseUrl: "https://synthetic.test", model: "synthetic", apiKeyEnc: "synthetic" };
    await expect(chatOnce(row, "synthetic", "synthetic")).rejects.toThrow("AI_REMOVED");
    for (const classify of [ollamaClassify, geminiClassify, groqClassify])
        await expect(classify([], [], {} as never)).rejects.toThrow("AI_REMOVED");
    await expect(generateCommentDraft({} as never, {} as never, async () => { })).rejects.toThrow("AI_REMOVED");
    expect((await testProviderRow({ ...row, id: "old", resetHourUtc: 0 })).ok).toBe(false);
    expect((await embedText("ข้อความ", {} as never)).vector).toBeNull();
    expect(network).not.toHaveBeenCalled();
});
