import { describe, expect, it, beforeEach } from "vitest";
import {
  AiCallError,
  COOLDOWN,
  MinuteWindow,
  classifyFailure,
  dayKey,
  nextReset,
  routeTask,
  type RouterProvider,
  type RouterStore,
} from "@/lib/ai/router";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/ai/secret-box";
import { providerData } from "@/lib/ai/provider-input";

const FAKE_KEY = "sk-test-SECRET-1234567890abcdef";

function provider(id: string, priority: number, extra: Partial<RouterProvider> = {}): RouterProvider {
  return { id, name: id, enabled: true, priority, tasks: ["classify"], limitPerMinute: null, limitPerDay: null, resetHourUtc: 0, cooldownUntil: null, requestsToday: 0, usageDay: null, ...extra };
}

function memoryStore() {
  const log: string[] = [];
  const store: RouterStore = {
    async recordSuccess(id) {
      log.push(`ok:${id}`);
    },
    async recordFailure(id, failure) {
      log.push(`fail:${id}:${failure.kind}:${failure.message}`);
    },
  };
  return { store, log };
}

let clock = new Date("2026-11-04T10:00:00Z");
const now = () => clock;

describe("AI provider router", () => {
  it("preserves Retry-After for the queue after recording a provider cooldown", async () => {
    const { store } = memoryStore();
    await expect(routeTask([provider("limited", 1)], "classify", { store, now, minute: new MinuteWindow() }, async () => {
      throw new AiCallError("rate limited", 429, 120_000);
    })).resolves.toMatchObject({ value: null });
    const { guardedCall } = await import("../../src/lib/ai/router");
    await expect(guardedCall(provider("retry", 1), "classify", { store, now, minute: new MinuteWindow() }, async () => {
      throw new AiCallError("rate limited", 429, 120_000);
    })).rejects.toMatchObject({ status: 429, retryAfterMs: 120_000 });
  });
  beforeEach(() => {
    clock = new Date("2026-11-04T10:00:00Z");
  });

  it("uses providers in priority order and stops at the first success", async () => {
    const { store, log } = memoryStore();
    const calls: string[] = [];
    const out = await routeTask([provider("b", 20), provider("a", 10)], "classify", { store, now, minute: new MinuteWindow() }, async (p) => {
      calls.push(p.id);
      return { value: p.id, tokens: 5 };
    });
    expect(out.value).toBe("a");
    expect(calls).toEqual(["a"]);
    expect(log).toEqual(["ok:a"]);
  });

  it("fails over on 429 and honours Retry-After, then returns when the cooldown ends", async () => {
    const { store } = memoryStore();
    const minute = new MinuteWindow();
    const a = provider("a", 10);
    const b = provider("b", 20);
    const call = async (p: RouterProvider) => {
      if (p.id === "a" && clock.getTime() < Date.parse("2026-11-04T10:00:30Z")) throw new AiCallError("HTTP 429", 429, 30_000);
      return { value: p.id };
    };
    expect((await routeTask([a, b], "classify", { store, now, minute }, call)).value).toBe("b");
    expect(a.cooldownUntil?.toISOString()).toBe("2026-11-04T10:00:30.000Z");
    clock = new Date("2026-11-04T10:00:10Z");
    const skipped: string[] = [];
    expect((await routeTask([a, b], "classify", { store, now, minute }, async (p) => { skipped.push(p.id); return call(p); })).value).toBe("b");
    expect(skipped).toEqual(["b"]);
    clock = new Date("2026-11-04T10:00:31Z");
    expect((await routeTask([a, b], "classify", { store, now, minute }, call)).value).toBe("a");
  });

  it("treats quota / insufficient credits as exhausted until the daily reset", () => {
    const at = new Date("2026-11-04T10:00:00Z");
    const quota = classifyFailure(new AiCallError("HTTP 429", 429, 0, "quota"), at, 0);
    expect(quota.kind).toBe("quota");
    expect(at.getTime() + quota.cooldownMs).toBe(Date.parse("2026-11-05T00:00:00Z"));
    const credits = classifyFailure(new AiCallError("HTTP 402", 402), at, 8);
    expect(credits.kind).toBe("quota");
    expect(at.getTime() + credits.cooldownMs).toBe(Date.parse("2026-11-05T08:00:00Z"));
    expect(nextReset(new Date("2026-11-04T07:00:00Z"), 8).toISOString()).toBe("2026-11-04T08:00:00.000Z");
  });

  it("cools down auth, 5xx and timeouts, but not bad requests", () => {
    const at = new Date();
    expect(classifyFailure(new AiCallError("HTTP 401", 401), at).cooldownMs).toBe(COOLDOWN.authMs);
    expect(classifyFailure(new AiCallError("HTTP 503", 503), at).kind).toBe("server");
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    expect(classifyFailure(timeout, at).kind).toBe("timeout");
    expect(classifyFailure(new AiCallError("HTTP 404", 404), at).cooldownMs).toBe(0);
  });

  it("falls back to rules (null) when every provider fails or is cooling down", async () => {
    const { store } = memoryStore();
    const a = provider("a", 10, { cooldownUntil: new Date("2026-11-04T11:00:00Z") });
    const b = provider("b", 20);
    const out = await routeTask([a, b], "classify", { store, now, minute: new MinuteWindow() }, async () => {
      throw new AiCallError("HTTP 500", 500);
    });
    expect(out.value).toBeNull();
    expect(b.cooldownUntil).not.toBeNull();
    expect("errors" in out && out.errors.length).toBe(2);
  });

  it("respects per-minute and per-day limits and skips disabled or other-task providers", async () => {
    const { store } = memoryStore();
    const minute = new MinuteWindow();
    const a = provider("a", 10, { limitPerMinute: 1 });
    const b = provider("b", 20, { limitPerDay: 1, usageDay: dayKey(clock), requestsToday: 1 });
    const c = provider("c", 30, { enabled: false });
    const d = provider("d", 40, { tasks: ["embed"] });
    const e = provider("e", 50);
    const used: string[] = [];
    const call = async (p: RouterProvider) => { used.push(p.id); return { value: p.id }; };
    await routeTask([a, b, c, d, e], "classify", { store, now, minute }, call);
    await routeTask([a, b, c, d, e], "classify", { store, now, minute }, call);
    expect(used).toEqual(["a", "e"]);
    clock = new Date("2026-11-04T10:01:01Z");
    await routeTask([a, b, c, d, e], "classify", { store, now, minute }, call);
    expect(used).toEqual(["a", "e", "a"]);
  });

  it("never puts the API key in stored errors or public output", async () => {
    process.env.AI_KEY_SECRET = "unit-test-secret-0123456789";
    const enc = encryptSecret(FAKE_KEY);
    expect(enc).not.toContain(FAKE_KEY);
    expect(decryptSecret(enc)).toBe(FAKE_KEY);
    expect(maskSecret(FAKE_KEY)).toBe("sk-…cdef");
    const data = providerData({ preset: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "x", apiKey: FAKE_KEY }, false);
    expect(JSON.stringify(data)).not.toContain(FAKE_KEY);
    const { store, log } = memoryStore();
    await routeTask([provider("a", 1)], "classify", { store, now, minute: new MinuteWindow() }, async () => {
      throw new AiCallError(`HTTP 401`, 401);
    });
    expect(log.join("\n")).not.toContain(FAKE_KEY);
  });
});
