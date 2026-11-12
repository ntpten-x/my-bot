import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
const source = readFileSync("extension/background.js", "utf8");
function harness() {
  const finishes: (() => void)[] = [];
  const route = vi.fn(() => new Promise<void>(resolve => { finishes.push(resolve); }));
  const config = vi.fn(async () => ({ token: "synthetic" }));
  const identity = vi.fn(async () => { throw new Error("stop before any transport"); });
  const context = vm.createContext({ applyServerRoute: route, loadConfig: config,
    probeFacebookIdentity: identity, cycle: vi.fn(), chrome: { storage: { local: { set: vi.fn(async () => undefined) } } } });
  vm.runInContext(source.slice(source.indexOf("let heartbeatWork = null"), source.indexOf("// ---- Read-only scroll scrape")), context);
  return { route, config, identity, finish: () => finishes.splice(0).forEach(resolve => resolve()), run: () => context.heartbeat() as Promise<void> };
}
it("shares the heartbeat guard before routing starts", async () => {
  const h = harness(); const first = h.run(), second = h.run();
  const shared = first === second;
  const calls = h.route.mock.calls.length;
  h.finish(); await Promise.all([first, second]);
  expect(calls).toBe(1); expect(h.identity).toHaveBeenCalledTimes(1); expect(shared).toBe(true);
});
it("releases the guard when configuration fails", async () => {
  const h = harness(); h.route.mockResolvedValue(undefined); h.config.mockRejectedValueOnce(new Error("config unavailable"));
  await h.run().catch(() => undefined); await h.run();
  expect(h.route).toHaveBeenCalledTimes(2); expect(h.identity).toHaveBeenCalledTimes(1);
});
