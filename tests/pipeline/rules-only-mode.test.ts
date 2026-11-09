import { afterEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn(async (): Promise<{ error: Response | null }> => ({ error: null })));
vi.mock("../../src/lib/guard", () => ({ authed: auth }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { setting: { findMany: async () => [
  { key: "ai_provider", value: "auto" }, { key: "ollama_base_url", value: "http://synthetic.invalid" },
  { key: "groq_api_key", value: "encrypted:invalid-historical-key" },
] } } }));
import { getSettings, publicSettings } from "../../src/lib/settings";
import { autoCommentRuleSchema } from "../../src/lib/auto-comment/schema";
import { GET as providers, POST as createProvider } from "../../src/app/api/ai-providers/route";
import { POST as probe } from "../../src/app/api/settings/test-ai/route";
import { POST as embed } from "../../src/app/api/settings/test-embed/route";
import { POST as queue } from "../../src/app/api/ai-queue/route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); auth.mockResolvedValue({ error: null }); });

it("ignores legacy settings and environment keys and publishes no model controls", async () => {
  vi.stubEnv("GROQ_API_KEY", "synthetic-not-a-real-key");
  vi.stubEnv("GEMINI_API_KEY", "synthetic-not-a-real-key");
  const settings = await getSettings();
  expect(settings).toMatchObject({ aiProvider: "rules", groqApiKey: "", geminiApiKey: "", ocrEnabled: false, visionOcr: false });
  expect(publicSettings(settings)).not.toHaveProperty("aiProvider");
  expect(publicSettings(settings)).not.toHaveProperty("embedModel");
});

it("retires old model APIs without making requests, while retaining authentication", async () => {
  const network = vi.fn(); vi.stubGlobal("fetch", network);
  for (const handler of [providers, createProvider, probe, embed, queue]) {
    const response = await handler();
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "AI_REMOVED" });
  }
  auth.mockResolvedValue({ error: new Response(null, { status: 401 }) });
  expect((await providers()).status).toBe(401);
  expect(network).not.toHaveBeenCalled();
});

it("rejects new model-dependent comment rules and accepts owner-authored templates", () => {
  const input = { name: "bot", sourceIds: ["synthetic"], templates: ["ข้อความที่เจ้าของกำหนด"], deliveryMode: "extension" };
  expect(autoCommentRuleSchema.safeParse(input).success).toBe(true);
  expect(autoCommentRuleSchema.safeParse({ ...input, requireAi: true }).success).toBe(false);
  expect(autoCommentRuleSchema.safeParse({ ...input, messageMode: "ai_draft" }).success).toBe(false);
});
