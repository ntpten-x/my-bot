import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
it("never caches owner documents or API responses, even after logout", () => {
  type FetchEvent = { request: { url: string; method: string }; respondWith: (value: unknown) => void };
  const listeners = new Map<string, (event: FetchEvent) => void>();
  const fetch = vi.fn();
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self: { addEventListener: (key: string, fn: (event: FetchEvent) => void) => listeners.set(key, fn), location: { origin: "https://mybot.example" } }, URL, Response, fetch });
  for (const path of ["/settings", "/feed", "/dashboard", "/login", "/api/settings", "/api/v1/stream"]) {
    const respondWith = vi.fn();
    listeners.get("fetch")!({ request: { url: `https://mybot.example${path}`, method: "GET" }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  }
  expect(fetch).not.toHaveBeenCalled();
});
