import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function harness(status: number) {
  const stored: Record<string, unknown> = { outbox: [{ sourceUrl: "https://www.facebook.com/groups/123", posts: [{ text: "synthetic" }], at: Date.now(), apiBase: "https://owner.example" }] };
  const source = readFileSync("extension/background.js", "utf8");
  const postJson = vi.fn(async () => ({ status, ok: status >= 200 && status < 300 }));
  const context = vm.createContext({ Date, Set, postJson, RETRY_STATUS: new Set([408, 429, 502, 503, 504]),
    countSent: vi.fn(), rememberError: vi.fn(), base: (cfg: { apiBase: string }) => cfg.apiBase,
    chrome: { storage: { local: {
      get: async (defaults: object) => ({ ...defaults, ...structuredClone(stored) }),
      set: async (value: object) => Object.assign(stored, structuredClone(value)),
    } } },
  });
  vm.runInContext(source.slice(source.indexOf("const OUTBOX_MAX ="), source.indexOf("async function countSent")), context);
  return { stored, postJson, flush: () => vm.runInContext('flushOutbox({ token: "synthetic", apiBase: "https://owner.example" })', context) as Promise<void> };
}
it.each([401, 403, 429, 503])("retains unsent posts for HTTP %i", async status => {
  const h = harness(status); await h.flush(); expect(h.stored.outbox).toHaveLength(1);
});
it("removes acknowledged posts", async () => { const h = harness(200); await h.flush(); expect(h.stored.outbox).toEqual([]); });
