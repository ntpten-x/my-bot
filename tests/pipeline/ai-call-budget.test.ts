import { afterEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { aiProvider: { update: db.update } } }));
vi.mock("../../src/lib/ai/secret-box", () => ({ decryptSecret: () => "synthetic", hasKeySecret: () => false }));
import { chatOnce, testProviderRow } from "../../src/lib/ai/provider-registry";
import { AiResponseError, classifyFailure } from "../../src/lib/ai/router";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const row = { kind: "openai", preset: "custom", baseUrl: "https://synthetic.test", model: "synthetic", apiKeyEnc: "synthetic" };
it("shares one timeout across JSON negotiation and supplies the output budget", async () => {
  let now = 10_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const budgets: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { budgets.push(ms); return new AbortController().signal; });
  const fetch = vi.fn(async (_url, init) => {
    expect(JSON.parse(init.body).max_tokens).toBe(5888);
    if (budgets.length === 1) { now += 800; return new Response("{}", { status: 400 }); }
    return Response.json({ choices: [{ message: { content: '{"items":[]}' } }] });
  });
  vi.stubGlobal("fetch", fetch);
  await chatOnce(row, "synthetic", "synthetic", { json: true, maxTokens: 5888, timeoutMs: 1000 });
  expect(budgets).toEqual([1000, 200]);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not start another request after the deadline expires", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const fetch = vi.fn(async () => { now = 1001; return new Response("{}", { status: 400 }); });
  vi.stubGlobal("fetch", fetch);
  await expect(chatOnce(row, "synthetic", "synthetic", { json: true, timeoutMs: 1000 })).rejects.toMatchObject({ name: "TimeoutError" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("briefly cools down unusable JSON without treating it as quota exhaustion", () => {
  expect(classifyFailure(new AiResponseError(), new Date())).toMatchObject({ kind: "invalid-response", cooldownMs: 60_000 });
});

it("a successful probe preserves routing cooldowns and owner quotas", async () => {
  db.update.mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })));
  expect((await testProviderRow({ ...row, id: "synthetic", resetHourUtc: 0 })).ok).toBe(true);
  const data = db.update.mock.calls.at(-1)![0].data;
  expect(data).not.toHaveProperty("cooldownUntil");
  expect(data).not.toHaveProperty("requestsToday");
});
