import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const route = createRequire(import.meta.url)("../../extension/server-route.js") as {
  normalizeOrigin(value: string): string | null;
  pickServerOrigin(input: {
    fetchFn: typeof fetch;
    getURL: (path: string) => string;
    stored: Record<string, unknown>;
    fallbackProduction: string;
  }): Promise<{ origin: string; mode: string; reason: string }>;
};

describe("extension server auto-route", () => {
  it("normalizes only https and loopback http origins", () => {
    expect(route.normalizeOrigin("https://my-bot-e6bt.onrender.com/")).toBe("https://my-bot-e6bt.onrender.com");
    expect(route.normalizeOrigin("http://localhost:8001")).toBe("http://localhost:8001");
    expect(route.normalizeOrigin("http://127.0.0.1:8001/")).toBe("http://127.0.0.1:8001");
    expect(route.normalizeOrigin("http://192.168.1.6:8001")).toBeNull();
  });

  it("prefers healthy local over production in auto mode", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes("127.0.0.1:8001/api/v1/health")) return { ok: true, json: async () => ({ ok: true, version: "1.3.7" }) };
      if (String(url).includes("install-config.json")) return { ok: true, json: async () => ({ apiBase: "https://my-bot-e6bt.onrender.com" }) };
      return { ok: false, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const picked = await route.pickServerOrigin({
      fetchFn,
      getURL: path => `chrome-extension://x/${path}`,
      stored: { apiBase: "https://my-bot-e6bt.onrender.com", apiBaseMode: "auto" },
      fallbackProduction: "https://my-bot-e6bt.onrender.com",
    });
    expect(picked).toMatchObject({ origin: "http://127.0.0.1:8001", reason: "local_healthy", mode: "auto" });
  });

  it("falls back to production when local is down but cloud is healthy", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes("/api/v1/health") && String(url).includes("onrender.com")) {
        return { ok: true, json: async () => ({ ok: true, version: "1.3.7" }) };
      }
      if (String(url).includes("install-config.json")) return { ok: true, json: async () => ({ apiBase: "https://my-bot-e6bt.onrender.com" }) };
      return { ok: false, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const picked = await route.pickServerOrigin({
      fetchFn,
      getURL: path => `chrome-extension://x/${path}`,
      stored: { apiBase: "http://localhost:8001", apiBaseMode: "auto" },
      fallbackProduction: "https://my-bot-e6bt.onrender.com",
    });
    expect(picked).toMatchObject({ origin: "https://my-bot-e6bt.onrender.com", reason: "production_healthy" });
  });

  it("prefers local fallback when cloud is suspended and local probe failed", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes("install-config.json")) return { ok: true, json: async () => ({ apiBase: "https://my-bot-e6bt.onrender.com" }) };
      return { ok: false, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const picked = await route.pickServerOrigin({
      fetchFn,
      getURL: path => `chrome-extension://x/${path}`,
      stored: { apiBase: "https://my-bot-e6bt.onrender.com", apiBaseMode: "auto" },
      fallbackProduction: "https://my-bot-e6bt.onrender.com",
    });
    expect(picked).toMatchObject({ origin: "http://127.0.0.1:8001", reason: "local_fallback" });
  });

  it("keeps a manual lock and a healthy comment journal origin", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, version: "1.3.7" }) })) as unknown as typeof fetch;
    const locked = await route.pickServerOrigin({
      fetchFn,
      getURL: path => path,
      stored: { apiBase: "https://my-bot-e6bt.onrender.com", apiBaseMode: "manual" },
      fallbackProduction: "https://my-bot-e6bt.onrender.com",
    });
    expect(locked).toMatchObject({ origin: "https://my-bot-e6bt.onrender.com", reason: "manual" });
    expect(fetchFn).not.toHaveBeenCalled();

    const inflight = await route.pickServerOrigin({
      fetchFn,
      getURL: path => path,
      stored: {
        apiBase: "http://localhost:8001",
        apiBaseMode: "auto",
        commentJournal: { apiBase: "https://my-bot-e6bt.onrender.com", id: "job" },
      },
      fallbackProduction: "https://my-bot-e6bt.onrender.com",
    });
    expect(inflight).toMatchObject({ origin: "https://my-bot-e6bt.onrender.com", reason: "comment_in_flight" });
  });

  it("skips an unhealthy comment journal host and uses local", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes("onrender.com")) return { ok: false, json: async () => ({}) };
      if (String(url).includes("127.0.0.1:8001/api/v1/health")) {
        return { ok: true, json: async () => ({ ok: true, version: "1.3.7" }) };
      }
      if (String(url).includes("install-config.json")) {
        return { ok: true, json: async () => ({ apiBase: "https://my-bot-e6bt.onrender.com" }) };
      }
      return { ok: false, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const picked = await route.pickServerOrigin({
      fetchFn,
      getURL: path => `chrome-extension://x/${path}`,
      stored: {
        apiBase: "http://127.0.0.1:8001",
        apiBaseMode: "auto",
        commentJournal: { apiBase: "https://my-bot-e6bt.onrender.com", id: "job" },
      },
      fallbackProduction: "https://my-bot-e6bt.onrender.com",
    });
    expect(picked).toMatchObject({ origin: "http://127.0.0.1:8001", reason: "local_healthy" });
  });
});
