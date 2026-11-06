import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function harness(enabled = true, failAuthorize = false) {
  const stored: Record<string, unknown> = { browserCommentsEnabled: enabled };
  const execute = vi.fn(async ({ args }: { args: [string, unknown] }) => [{ result: args[0] === "observe" ? { ok: true, outcome: "observed", commentUrl: "https://www.facebook.com/groups/12345/posts/8888/?comment_id=777" } : { ok: true } }]);
  const tabs = { create: vi.fn(async () => ({ id: 1 })), remove: vi.fn(async () => undefined) };
  const postJson = vi.fn(async (_cfg, _path, body) => {
    if (body.action === "authorize" && failAuthorize) throw new Error("lost authorization response");
    return { ok: true, json: async () => body.action === "claim" ? { job: { id: "job", claimToken: "synthetic-claim", externalUrl: "https://www.facebook.com/groups/12345/posts/8888/", fbUserId: "99887766", message: "ข้อความทดสอบ" } } : body.action === "authorize" ? { grant: { ttlMs: 3000 } } : { ok: true } };
  });
  const context = vm.createContext({ Date, chrome: { tabs, scripting: { executeScript: execute }, storage: { local: {
    get: async (defaults: object) => ({ ...defaults, ...structuredClone(stored) }),
    set: async (value: object) => Object.assign(stored, structuredClone(value)),
    remove: async (key: string) => { delete stored[key]; },
  } } }, MyBotBrowserComment: { action: () => undefined } });
  vm.runInContext(readFileSync("extension/comment-worker.js", "utf8"), context);
  const worker = context.MyBotCommentWorker as { run(deps: object): Promise<void>; recover(deps: object): Promise<void> };
  const deps = { loadConfig: async () => ({ apiBase: "https://owner.example", token: "mbd_synthetic", paused: false }), base: (cfg: { apiBase: string }) => cfg.apiBase,
    currentFbUserId: async () => "99887766", postJson, waitComplete: async () => undefined, sleep: async () => undefined, rememberError: vi.fn(async () => undefined) };
  return { worker, deps, stored, execute, tabs, postJson };
}
it("does nothing until the local opt-in is enabled", async () => {
  const h = harness(false); await h.worker.run(h.deps); expect(h.postJson).not.toHaveBeenCalled(); expect(h.tabs.create).not.toHaveBeenCalled();
});
it("opens a server-assigned target and invokes send only once", async () => {
  const h = harness(); await h.worker.run(h.deps);
  expect(h.execute.mock.calls.filter(([call]) => call.args[0] === "send")).toHaveLength(1);
  expect(h.postJson.mock.calls.map(([, , body]) => body.action)).toEqual(["claim", "authorize", "report", "report"]);
  expect(h.stored.commentJournal).toBeUndefined(); expect(h.tabs.remove).toHaveBeenCalledWith(1);
});
it("does not click when the authorization response is lost", async () => {
  const h = harness(true, true); await h.worker.run(h.deps);
  expect(h.execute.mock.calls.some(([call]) => call.args[0] === "send")).toBe(false);
  expect(h.postJson.mock.calls.some(([, , body]) => body.action === "report" && body.outcome === "uncertain")).toBe(true);
});
it("recovers a persisted sending journal by reporting, never by reopening or resending", async () => {
  const h = harness(); h.stored.commentJournal = { id: "old", claimToken: "synthetic-old", apiBase: "https://owner.example", state: "sending" };
  await h.worker.run(h.deps); expect(h.tabs.create).not.toHaveBeenCalled();
  await h.worker.recover(h.deps);
  expect(h.postJson.mock.calls.map(([, , body]) => body.action)).toEqual(["report"]); expect(h.execute).not.toHaveBeenCalled(); expect(h.stored.commentJournal).toBeUndefined();
});
it("preserves a journal when a device is revoked or the server is unavailable", async () => {
  const h = harness(); h.stored.commentJournal = { id: "old", claimToken: "synthetic-old", apiBase: "https://owner.example", state: "sending" };
  h.postJson.mockRejectedValue(new Error("offline")); await h.worker.recover(h.deps);
  expect(h.stored.commentJournal).toBeDefined(); expect(h.tabs.create).not.toHaveBeenCalled();
});
