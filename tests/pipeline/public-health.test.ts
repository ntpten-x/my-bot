import { describe, expect, it, vi } from "vitest";
import { buildHealth, createHealthCache, httpStatusFor, type HealthDeps } from "@/lib/public-health";

function deps(over: Partial<HealthDeps> = {}): HealthDeps {
  let t = 1_000_000;
  return {
    pingDb: async () => { t += 5; },
    availableAiProviders: async () => 2,
    extensionLastSeen: async () => new Date(1_000_000 - 30_000),
    version: "1.2.3",
    startedAt: 1_000_000 - 90_000,
    now: () => t,
    ...over,
  };
}

describe("public health", () => {
  it("reports ok with db latency, ai count and extension age", async () => {
    const r = await buildHealth(deps());
    expect(r.status).toBe("ok");
    expect(httpStatusFor(r)).toBe(200);
    expect(r.version).toBe("1.2.3");
    expect(r.uptimeSec).toBe(90);
    expect(r.checks.db).toEqual({ ok: true, latencyMs: 5 });
    expect(r.checks.ai).toEqual({ ok: true, availableProviders: 2 });
    expect(r.checks.extension.lastSeenAgoSec).toBe(30);
  });

  it("is degraded (200) when no AI provider is available", async () => {
    const r = await buildHealth(deps({ availableAiProviders: async () => 0, extensionLastSeen: async () => null }));
    expect(r.status).toBe("degraded");
    expect(httpStatusFor(r)).toBe(200);
    expect(r.checks.extension.lastSeenAgoSec).toBeNull();
  });

  it("is down (503) when the db fails or times out", async () => {
    const failed = await buildHealth(deps({ pingDb: async () => { throw new Error("password=secret"); } }));
    expect(failed.status).toBe("down");
    expect(httpStatusFor(failed)).toBe(503);
    expect(JSON.stringify(failed)).not.toContain("secret");
    const slow = await buildHealth(deps({ pingDb: () => new Promise(() => {}), dbTimeoutMs: 20, now: Date.now }));
    expect(slow.status).toBe("down");
    expect(slow.checks.db.latencyMs).toBeNull();
  });

  it("still answers when the ai/extension lookups throw", async () => {
    const r = await buildHealth(deps({ availableAiProviders: async () => { throw new Error("x"); } }));
    expect(r.status).toBe("degraded");
    expect(r.checks.db.ok).toBe(true);
  });

  it("caches the report within the ttl and dedupes concurrent builds", async () => {
    let t = 0;
    const get = createHealthCache(7000, () => t);
    const build = vi.fn(() => buildHealth(deps()));
    await Promise.all([get(build), get(build)]);
    t = 6000; await get(build);
    expect(build).toHaveBeenCalledTimes(1);
    t = 8000; await get(build);
    expect(build).toHaveBeenCalledTimes(2);
  });
});