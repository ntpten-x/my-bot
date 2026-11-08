import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function harness(enabled = true, failAuthorize = false, authorizeDelay = 0) {
  let clock = Date.now();
  class Clock extends Date { static now() { return clock; } }
  const stored: Record<string, unknown> = { browserCommentsEnabled: enabled };
  const session: Record<string, unknown> = {};
  const execute = vi.fn(async ({ args }: { args: [string, unknown] }) => [{ result: args[0] === "observe" ? { ok: true, outcome: "observed", commentUrl: "https://www.facebook.com/groups/12345/posts/8888/?comment_id=777" } : { ok: true } }]);
  const tabs = { create: vi.fn(async () => ({ id: 1 })), remove: vi.fn(async () => undefined) };
  const postJson = vi.fn(async (_cfg, _path, body) => {
    if (body.action === "authorize") clock += authorizeDelay;
    if (body.action === "authorize" && failAuthorize) throw new Error("lost authorization response");
    return { ok: true, json: async () => body.action === "claim" ? { job: { id: "job", claimToken: "synthetic-claim", externalUrl: "https://www.facebook.com/groups/12345/posts/8888/", fbUserId: "99887766", message: "ข้อความทดสอบ" } } : body.action === "authorize" ? { grant: { ttlMs: 3000 } } : { ok: true } };
  });
  const context = vm.createContext({ Date: Clock, setTimeout, clearTimeout, chrome: { tabs, scripting: { executeScript: execute }, storage: { session: {get: async (defaults:object)=>({...defaults,...structuredClone(session)}),set: async (value:object)=>Object.assign(session,structuredClone(value))}, local: {
    get: async (defaults: object) => ({ ...defaults, ...structuredClone(stored) }),
    set: async (value: object) => Object.assign(stored, structuredClone(value)),
    remove: async (key: string) => { delete stored[key]; },
  } } }, MyBotBrowserComment: { action: () => undefined } });
  vm.runInContext(readFileSync("extension/focus.js", "utf8"), context);
  vm.runInContext(readFileSync("extension/comment-worker.js", "utf8"), context);
  const worker = context.MyBotCommentWorker as { run(deps: object): Promise<void>; recover(deps: object): Promise<void> };
  const deps = { loadConfig: async () => ({ apiBase: "https://owner.example", token: "mbd_synthetic", paused: false }), base: (cfg: { apiBase: string }) => cfg.apiBase,
    currentFbUserId: async () => "99887766", postJson, waitComplete: async () => undefined, sleep: async () => undefined, rememberError: vi.fn(async () => undefined) };
  return { worker, deps, stored, session, execute, tabs, postJson };
}
it("receives only server-approved work after pairing even when the obsolete local toggle is off", async () => {
  const h = harness(false); await h.worker.run(h.deps);
  expect(h.postJson.mock.calls.map(([, , body])=>body.action)).toEqual(['claim','authorize','report']);
  expect(h.execute.mock.calls.filter(([call])=>call.args[0]==='send')).toHaveLength(1);
});
it("never claims with an unpaired or legacy shared token",async()=>{
  const h=harness();h.deps.loadConfig=async()=>({apiBase:'https://owner.example',token:'legacy',paused:false});
  await h.worker.run(h.deps);expect(h.postJson).not.toHaveBeenCalled();expect(h.tabs.create).not.toHaveBeenCalled();
});
it("keeps collection pause separate from server-controlled comment delivery",async()=>{
  const h=harness();h.deps.loadConfig=async()=>({apiBase:'https://owner.example',token:'mbd_synthetic',paused:true});
  await h.worker.run(h.deps);expect(h.postJson.mock.calls.some(([, , body])=>body.action==='authorize')).toBe(true);
});
it("opens a server-assigned target and invokes send only once", async () => {
  const h = harness(); await h.worker.run(h.deps);
  expect(h.execute.mock.calls.filter(([call]) => call.args[0] === "send")).toHaveLength(1);
  expect(h.postJson.mock.calls.map(([, , body]) => body.action)).toEqual(["claim", "authorize", "report"]);
  expect(h.stored.commentJournal).toBeUndefined(); expect(h.tabs.remove).toHaveBeenCalledWith(1);
});
it("does not click when the authorization response is lost", async () => {
  const h = harness(true, true); await h.worker.run(h.deps);
  expect(h.execute.mock.calls.some(([call]) => call.args[0] === "send")).toBe(false);
  expect(h.postJson.mock.calls.some(([, , body]) => body.action === "report" && body.outcome === "not_sent")).toBe(true);
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
it("does not claim or open a tab while its Facebook account is paused", async () => {
  const h = harness();
  h.deps.loadConfig = async () => ({ apiBase: "https://owner.example", token: "mbd_synthetic", paused: false, accountPaused: true });
  await h.worker.run(h.deps); expect(h.postJson).not.toHaveBeenCalled(); expect(h.tabs.create).not.toHaveBeenCalled();
});

it("reports success once, without a second uncertain report", async () => {
  const h = harness(); await h.worker.run(h.deps);
  expect(h.postJson.mock.calls.filter(([, , body]) => body.action === "report")).toHaveLength(1);
});
it("reports a known unclicked expired permit as not_sent", async () => {
  const h = harness(true, false, 4000); await h.worker.run(h.deps);
  expect(h.execute.mock.calls.some(([call]) => call.args[0] === "send")).toBe(false);
  expect(h.postJson.mock.calls.filter(([, , body]) => body.action === "report").map(([, , body]) => body.outcome)).toEqual(["not_sent"]);
});
it("retains the original observed report after an outage and recovers without another send", async () => {
  const h = harness(); const original = h.postJson.getMockImplementation()!; let offline = true;
  h.postJson.mockImplementation(async (cfg, path, body) => {
    if (body.action === "report" && offline) throw new Error("report offline");
    return original(cfg, path, body);
  });
  await h.worker.run(h.deps);
  expect(h.stored.commentJournal).toMatchObject({ pendingReport: { outcome: "observed" } });
  expect(h.postJson.mock.calls.filter(([, , body]) => body.action === "report")).toHaveLength(1);
  offline = false; await h.worker.recover(h.deps);
  expect(h.stored.commentJournal).toBeUndefined();
  expect(h.execute.mock.calls.filter(([call]) => call.args[0] === "send")).toHaveLength(1);
  expect(h.postJson.mock.calls.filter(([, , body]) => body.action === "report").map(([, , body]) => body.outcome)).toEqual(["observed", "observed"]);
});
it("does not discard an unacknowledged report on HTTP 200", async () => {
  const h = harness(); const original = h.postJson.getMockImplementation()!;
  h.postJson.mockImplementation(async (cfg, path, body) => body.action === "report" ? { ok: true, json: async () => ({ ok: false }) } : original(cfg, path, body));
  await h.worker.run(h.deps); expect(h.stored.commentJournal).toBeDefined();
  await h.worker.recover(h.deps); expect(h.stored.commentJournal).toBeDefined();
  expect(h.execute.mock.calls.filter(([call]) => call.args[0] === "send")).toHaveLength(1);
});
it("recovers an authorizing checkpoint as definitely not sent without opening a tab", async () => {
  const h = harness();
  h.stored.commentJournal = { id: "old", claimToken: "synthetic-old", apiBase: "https://owner.example", state: "authorizing" };
  await h.worker.recover(h.deps);
  expect(h.postJson.mock.calls.map(([, , body]) => body.outcome)).toEqual(["not_sent"]);
  expect(h.tabs.create).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
});
it("keeps ambiguous send invocation failures uncertain", async () => {
  const h = harness(); const original = h.execute.getMockImplementation()!;
  h.execute.mockImplementation(async options => { if (options.args[0] === "send") throw new Error("send response lost"); return original(options); });
  await h.worker.run(h.deps);
  expect(h.postJson.mock.calls.filter(([, , body]) => body.action === "report").map(([, , body]) => body.outcome)).toEqual(["uncertain"]);
});
it("does not open a tab when preflight returns no eligible work", async () => {
  const h = harness(); h.postJson.mockResolvedValue({ ok: true, json: async () => ({ job: null }) });
  await h.worker.run(h.deps); expect(h.tabs.create).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
});

it('holds focus before opening the comment tab and releases it on completion',async()=>{
  const h=harness();h.tabs.create.mockImplementation(async()=>{expect(h.session.commentFocusLease).toMatchObject({owner:'job'});return{id:1};});
  await h.worker.run(h.deps);expect(h.session.commentFocusLease).toBeNull();
});
it('does not claim another job while an unexpired focus lease belongs to recovery',async()=>{
  const h=harness();h.session.commentFocusLease={owner:'old',until:Date.now()+60000};
  await h.worker.run(h.deps);expect(h.postJson).not.toHaveBeenCalled();expect(h.tabs.create).not.toHaveBeenCalled();
});

it('bounds a stalled preparation and releases focus without requesting a send grant',async()=>{
  vi.useFakeTimers();
  try {
    const h=harness();h.execute.mockImplementation(()=>new Promise(()=>{}));
    const work=h.worker.run(h.deps);await vi.advanceTimersByTimeAsync(6000);await work;
    expect(h.postJson.mock.calls.map(([, , body])=>body.action)).toEqual(['claim','report']);
    expect(h.session.commentFocusLease).toBeNull();expect(h.tabs.remove).toHaveBeenCalledWith(1);
  }finally{vi.useRealTimers();}
});
it('preserves ambiguity when send itself stops responding instead of clicking again',async()=>{
  vi.useFakeTimers();
  try {
    const h=harness();const original=h.execute.getMockImplementation()!;
    h.execute.mockImplementation(options=>options.args[0]==='send'?new Promise(()=>{}):original(options));
    const work=h.worker.run(h.deps);await vi.advanceTimersByTimeAsync(6000);await work;
    expect(h.execute.mock.calls.filter(([call])=>call.args[0]==='send')).toHaveLength(1);
    expect(h.postJson.mock.calls.filter(([, , body])=>body.action==='report').map(([, , body])=>body.outcome)).toEqual(['uncertain']);
    expect(h.session.commentFocusLease).toBeNull();
  }finally{vi.useRealTimers();}
});
