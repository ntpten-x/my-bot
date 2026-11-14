import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function harness(enabled = true, failAuthorize = false, authorizeDelay = 0) {
  let clock = Date.now();
  let openedUrl = "https://www.facebook.com/groups/12345/posts/8888/";
  class Clock extends Date { static now() { return clock; } }
  const stored: Record<string, unknown> = { browserCommentsEnabled: enabled };
  const session: Record<string, unknown> = {};
  const execute = vi.fn(async ({ args }: { args: [string, unknown] }) => [{ result: args[0] === "observe" ? { ok: true, outcome: "observed", commentUrl: "https://www.facebook.com/groups/12345/posts/8888/?comment_id=777" } : { ok: true } }]);
  const alarms = { get: vi.fn(async () => undefined), create: vi.fn(async () => undefined) };
  const tabs = { create: vi.fn(async ({url}:{url:string}) => { openedUrl=url;return { id: 1 }; }), remove: vi.fn(async () => undefined), get: vi.fn(async (id: number) => ({ id, url: openedUrl })) };
  const postJson = vi.fn(async (_cfg, _path, body) => {
    if (body.action === "authorize") clock += authorizeDelay;
    if (body.action === "authorize" && failAuthorize) throw new Error("lost authorization response");
    return { ok: true, json: async () => body.action === "claim" ? { job: { id: "job", claimToken: "synthetic-claim", externalUrl: "https://www.facebook.com/groups/12345/posts/8888/", fbUserId: "99887766", message: "ข้อความทดสอบ" } } : body.action === "authorize" ? { grant: { ttlMs: 3000 } } : { ok: true } };
  });
  const context = vm.createContext({ Date: Clock, URL, setTimeout, clearTimeout, AbortController, btoa, fetch: vi.fn(), chrome: { alarms, tabs, scripting: { executeScript: execute }, storage: { session: {get: async (defaults:object)=>({...defaults,...structuredClone(session)}),set: async (value:object)=>Object.assign(session,structuredClone(value))}, local: {
    get: async (defaults: object) => ({ ...defaults, ...structuredClone(stored) }),
    set: async (value: object) => Object.assign(stored, structuredClone(value)),
    remove: async (key: string) => { delete stored[key]; },
  } } }, MyBotBrowserComment: { action: () => undefined } });
  vm.runInContext(readFileSync("extension/focus.js", "utf8"), context);
  vm.runInContext(readFileSync("extension/tab-lifecycle.js", "utf8"), context);
  vm.runInContext(readFileSync("extension/comment-worker.js", "utf8"), context);
  const worker = context.MyBotCommentWorker as { run(deps: object): Promise<boolean | undefined>; recover(deps: object): Promise<void>; drain(deps: object): Promise<void>; isBusy(): boolean };
  const deps = { loadConfig: async () => ({ apiBase: "https://owner.example", token: "mbd_synthetic", paused: false }), base: (cfg: { apiBase: string }) => cfg.apiBase,
    currentFbUserId: async () => "99887766", postJson, waitComplete: async () => undefined, sleep: async (ms: number) => { clock+=ms; }, rememberError: vi.fn(async () => undefined) };
  return { alarms, worker, deps, stored, session, execute, tabs, postJson, context, advance: (ms: number) => { clock+=ms; }, now:()=>clock };
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
it("persists a reason when observation cannot prove the comment author", async () => {
  const h = harness(); const original = h.execute.getMockImplementation()!;
  h.execute.mockImplementation(async options => ["observe", "reconcile"].includes(options.args[0])
    ? [{ result: { ok: false, outcome: "uncertain", reason: "observation_author_unverified" } }]
    : original(options));
  await h.worker.run(h.deps);
  expect(h.postJson.mock.calls.find(([, , body]) => body.action === "report")?.[2]).toMatchObject({ outcome: "uncertain", reason: "observation_author_unverified" });
  expect(h.execute.mock.calls.filter(([call]) => call.args[0] === "send")).toHaveLength(1);
});
it("reports a definite no-click decision after a grant without retrying the send", async () => {
  const h = harness(); const original = h.execute.getMockImplementation()!;
  h.execute.mockImplementation(async options => options.args[0] === "send"
    ? [{ result: { ok: false, outcome: "not_sent", reason: "send_precondition_changed" } }]
    : original(options));
  await h.worker.drain(h.deps);
  expect(h.postJson.mock.calls.find(([, , body]) => body.action === "report")?.[2]).toMatchObject({ outcome: "not_sent", reason: "send_precondition_changed" });
  expect(h.execute.mock.calls.filter(([call]) => call.args[0] === "send")).toHaveLength(1);
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

it('closes a recorded bot tab after MV3 restart even if the success journal was already cleared',async()=>{
  const h=harness();h.session.commentTab={jobId:'old',tabId:1,url:'https://www.facebook.com/groups/12345/posts/8888/'};
  await h.worker.recover(h.deps);
  expect(h.tabs.remove).toHaveBeenCalledWith(1);
  expect(h.session.commentTab).toBeNull();
  expect(h.tabs.create).not.toHaveBeenCalled();expect(h.postJson).not.toHaveBeenCalled();
});

it('never closes or inspects an unowned personal tab to recover an old journal',async()=>{
  const h=harness();h.stored.commentJournal={id:'old',claimToken:'synthetic-old',apiBase:'https://owner.example',state:'sending',at:Date.now(),job:{externalUrl:'https://www.facebook.com/groups/12345/posts/8888/'}};
  await h.worker.recover(h.deps);
  expect(h.tabs.get).not.toHaveBeenCalled();expect(h.tabs.remove).not.toHaveBeenCalled();
  expect(h.execute).not.toHaveBeenCalled();
  expect(h.postJson.mock.calls[0][2]).toMatchObject({action:'report',outcome:'uncertain'});
});

it('cleans up the owned tab during an outage while retaining the pending report',async()=>{
  const h=harness();h.session.commentTab={jobId:'old',tabId:1,url:'https://www.facebook.com/groups/12345/posts/8888/'};
  h.stored.commentJournal={id:'old',claimToken:'synthetic-old',apiBase:'https://owner.example',state:'sending',pendingReport:{outcome:'uncertain'}};
  h.postJson.mockRejectedValue(new Error('offline'));
  await h.worker.recover(h.deps);
  expect(h.tabs.remove).toHaveBeenCalledWith(1);expect(h.session.commentTab).toBeNull();
  expect(h.stored.commentJournal).toMatchObject({pendingReport:{outcome:'uncertain'}});
});

it('retries tab removal without resending a completed comment',async()=>{
  const h=harness();h.tabs.remove.mockRejectedValueOnce(new Error('temporary browser error'));
  await h.worker.run(h.deps);
  expect(h.session.commentTab).toMatchObject({tabId:1});
  h.advance(30_001); await h.worker.recover(h.deps);
  expect(h.session.commentTab).toBeNull();expect(h.tabs.remove).toHaveBeenCalledTimes(2);
  expect(h.execute.mock.calls.filter(([call])=>call.args[0]==='send')).toHaveLength(1);
});

it('keeps comment ownership after a temporary tab lookup failure and retries without sending',async()=>{
  const h=harness();h.session.commentTab={jobId:'old',tabId:1,url:'https://www.facebook.com/groups/12345/posts/8888/'};
  h.tabs.get.mockRejectedValueOnce(new Error('temporary'));
  await h.worker.recover(h.deps);
  expect(h.session.commentTab).toMatchObject({tabId:1,closing:true,closeAttempts:1});
  await h.worker.recover(h.deps);
  expect(h.tabs.remove).not.toHaveBeenCalled();
  h.advance(30_001);await h.worker.recover(h.deps);
  expect(h.tabs.remove).toHaveBeenCalledWith(1);expect(h.session.commentTab).toBeNull();
  expect(h.postJson).not.toHaveBeenCalled();expect(h.execute).not.toHaveBeenCalled();
});

it('leaves a bot-created comment tab alone once the owner has navigated it elsewhere',async()=>{
  const h=harness();h.tabs.get.mockResolvedValue({id:1,url:'https://example.com/owner-page'});
  await h.worker.run(h.deps);
  expect(h.tabs.remove).not.toHaveBeenCalled();expect(h.session.commentTab).toBeNull();
});

it('bounds a stalled recovery and still closes the owned tab without another send',async()=>{
  vi.useFakeTimers();
  try {
    const h=harness();h.session.commentTab={jobId:'old',tabId:1,url:'https://www.facebook.com/groups/12345/posts/8888/'};
    h.stored.commentJournal={id:'old',claimToken:'synthetic-old',apiBase:'https://owner.example',state:'sending',at:Date.now(),job:{externalUrl:'https://www.facebook.com/groups/12345/posts/8888/'}};
    h.execute.mockImplementation(()=>new Promise(()=>{}));
    const work=h.worker.recover(h.deps);await vi.advanceTimersByTimeAsync(6000);await work;
    expect(h.tabs.remove).toHaveBeenCalledWith(1);
    expect(h.execute.mock.calls.map(([call])=>call.args[0])).toEqual(['reconcile']);
    expect(h.stored.commentJournal).toBeDefined();
  }finally{vi.useRealTimers();}
});

it('drains at most three observed jobs sequentially without waiting for another alarm',async()=>{
  const h=harness();const original=h.postJson.getMockImplementation()!;let claims=0;
  h.postJson.mockImplementation(async(cfg,path,body)=>{
    const response=await original(cfg,path,body);
    if(body.action==='claim') {
      claims++;
      return {...response,json:async()=>({job:{id:`job-${claims}`,claimToken:`synthetic-${claims}`,externalUrl:'https://www.facebook.com/groups/12345/posts/8888/',fbUserId:'99887766',message:'synthetic'}})};
    }
    return response;
  });
  await Promise.all([h.worker.drain(h.deps),h.worker.drain(h.deps)]);
  expect(claims).toBe(3);
  expect(h.postJson.mock.calls.map(([, , body])=>body.action)).toEqual(['claim','authorize','report','claim','authorize','report','claim','authorize','report']);
  expect(h.tabs.remove).toHaveBeenCalledTimes(3);
});

it('stops draining immediately after an ambiguous send',async()=>{
  const h=harness();const original=h.execute.getMockImplementation()!;
  h.execute.mockImplementation(async options=>options.args[0]==='send'?[{result:{ok:false,outcome:'uncertain'}}]:original(options));
  await h.worker.drain(h.deps);
  expect(h.postJson.mock.calls.filter(([, , body])=>body.action==='claim')).toHaveLength(1);
  expect(h.execute.mock.calls.filter(([call])=>call.args[0]==='send')).toHaveLength(1);
});

it('does not authorize a job whose claim has already expired while the page loads',async()=>{
  const h=harness();h.deps.waitComplete=async()=>{h.advance(125000);};
  await h.worker.run(h.deps);
  expect(h.postJson.mock.calls.some(([, , body])=>body.action==='authorize')).toBe(false);
  expect(h.execute.mock.calls.some(([call])=>call.args[0]==='send')).toBe(false);
  expect(h.tabs.remove).toHaveBeenCalledWith(1);
});

it('yields the drain budget after a slow successful job instead of opening another tab',async()=>{
  const h=harness();h.deps.waitComplete=async()=>{h.advance(50000);};
  await h.worker.drain(h.deps);
  expect(h.postJson.mock.calls.filter(([, , body])=>body.action==='claim')).toHaveLength(1);
  expect(h.execute.mock.calls.filter(([call])=>call.args[0]==='send')).toHaveLength(1);
  expect(h.alarms.create).toHaveBeenCalledWith('mybot-comment-due', { when: h.now() + 1000 });
});

it('obeys a server stop or quota decision between jobs instead of preclaiming a batch',async()=>{
  const h=harness();const original=h.postJson.getMockImplementation()!;let claims=0;
  h.postJson.mockImplementation(async(cfg,path,body)=>{
    if(body.action==='claim' && ++claims>1) return {ok:true,json:async()=>({job:null})};
    return original(cfg,path,body);
  });
  await h.worker.drain(h.deps);
  expect(claims).toBe(2);expect(h.tabs.create).toHaveBeenCalledTimes(1);
  expect(h.execute.mock.calls.filter(([call])=>call.args[0]==='send')).toHaveLength(1);
});

it('does not drain another job after an expired click grant',async()=>{
  const h=harness(true,false,4000);await h.worker.drain(h.deps);
  expect(h.postJson.mock.calls.filter(([, , body])=>body.action==='claim')).toHaveLength(1);
  expect(h.execute.mock.calls.some(([call])=>call.args[0]==='send')).toBe(false);
});

it('bounds observation work within the claim lease and reports uncertainty without sending again',async()=>{
  const h=harness();const started=h.now();const original=h.execute.getMockImplementation()!;
  h.execute.mockImplementation(async options=>{
    if(options.args[0]==='observe'){h.advance(7000);return [{result:{ok:false,outcome:'uncertain'}}];}
    return original(options);
  });
  await h.worker.drain(h.deps);
  expect(h.now()-started).toBeLessThan(120000);
  expect(h.execute.mock.calls.filter(([call])=>call.args[0]==='send')).toHaveLength(1);
  expect(h.postJson.mock.calls.filter(([, , body])=>body.action==='report').map(([, , body])=>body.outcome)).toEqual(['uncertain']);
  expect(h.tabs.remove).toHaveBeenCalledWith(1);
});

it.each(['claim', 'report'])('releases the comment runner when the %s response body stalls', async action => {
  vi.useFakeTimers();
  try {
    const h = harness(); const original = h.postJson.getMockImplementation()!;
    h.postJson.mockImplementation(async (cfg, path, body) => body.action === action
      ? { ok: true, json: () => new Promise(() => {}) }
      : original(cfg, path, body));
    let finished = false;
    const work = h.worker.run(h.deps).finally(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(16000);
    expect(finished).toBe(true);
    await work;
    expect(h.worker.isBusy()).toBe(false);
    expect(h.session.commentFocusLease || null).toBeNull();
    if (action === 'report') {
      expect(h.stored.commentJournal).toMatchObject({ pendingReport: { outcome: 'observed' } });
      expect(h.execute.mock.calls.filter(([call]) => call.args[0] === 'send')).toHaveLength(1);
    } else expect(h.tabs.create).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it('retains the journal and releases recovery when a report response body stalls', async () => {
  vi.useFakeTimers();
  try {
    const h = harness();
    h.stored.commentJournal = { id: 'old', claimToken: 'synthetic-old', apiBase: 'https://owner.example', state: 'sending', pendingReport: { outcome: 'uncertain' } };
    h.postJson.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    let finished = false;
    const work = h.worker.recover(h.deps).finally(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(16000);
    expect(finished).toBe(true);
    await work;
    expect(h.worker.isBusy()).toBe(false);
    expect(h.stored.commentJournal).toMatchObject({ pendingReport: { outcome: 'uncertain' } });
    expect(h.execute).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it.each(['headers', 'body'])('aborts an image stalled at %s and reports without requesting a send grant', async phase => {
  vi.useFakeTimers();
  try {
    const h = harness(); const original = h.postJson.getMockImplementation()!;
    h.postJson.mockImplementation(async (cfg, path, body) => {
      if (body.action === 'claim') return { ok: true, json: async () => ({ job: { id: 'job', claimToken: 'synthetic-claim', externalUrl: 'https://www.facebook.com/groups/12345/posts/8888/', imageUrl: 'https://images.example/stalled' } }) };
      return original(cfg, path, body);
    });
    let signal: AbortSignal | undefined;
    h.context.fetch = vi.fn((_url, options) => {
      signal = options?.signal;
      return phase === 'headers' ? new Promise(() => {}) : Promise.resolve({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: () => new Promise(() => {}) });
    });
    let finished = false;
    const work = h.worker.run(h.deps).finally(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(16000);
    expect(finished).toBe(true);
    await work;
    expect(signal?.aborted).toBe(true);
    expect(h.worker.isBusy()).toBe(false);
    expect(h.session.commentFocusLease).toBeNull();
    expect(h.postJson.mock.calls.map(([, , body]) => body.action)).toEqual(['claim', 'report']);
    expect(h.postJson.mock.calls[1][2]).toMatchObject({ outcome: 'failed', reason: 'image_attach_failed' });
    expect(h.execute).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it('rejects an image stream exceeding the server upload limit before authorizing', async () => {
  const h = harness(); const original = h.postJson.getMockImplementation()!;
  h.postJson.mockImplementation(async (cfg, path, body) => {
    if (body.action === 'claim') return { ok: true, json: async () => ({ job: { id: 'job', claimToken: 'synthetic-claim', externalUrl: 'https://www.facebook.com/groups/12345/posts/8888/', imageUrl: 'https://images.example/oversized' } }) };
    return original(cfg, path, body);
  });
  let cancelled = false;
  h.context.fetch = vi.fn(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(Math.floor(2.5 * 1024 * 1024) + 1)); },
    pull(controller) { controller.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }), { headers: { 'content-type': 'image/png' } }));
  await h.worker.run(h.deps);
  expect(h.postJson.mock.calls.map(([, , body]) => body.action)).toEqual(['claim', 'report']);
  expect(h.postJson.mock.calls[1][2]).toMatchObject({ outcome: 'failed', reason: 'image_attach_failed' });
  expect(cancelled).toBe(true);
  expect(h.worker.isBusy()).toBe(false);
});

it('accepts an image at the server upload limit and sends it only once', async () => {
  const h = harness(); const original = h.postJson.getMockImplementation()!;
  h.postJson.mockImplementation(async (cfg, path, body) => {
    if (body.action === 'claim') return { ok: true, json: async () => ({ job: { id: 'job', claimToken: 'synthetic-claim', externalUrl: 'https://www.facebook.com/groups/12345/posts/8888/', imageUrl: 'https://images.example/valid' } }) };
    return original(cfg, path, body);
  });
  const limitBytes = Math.floor(2.5 * 1024 * 1024);
  h.context.fetch = vi.fn(async () => new Response(new Uint8Array(limitBytes), { headers: { 'content-type': 'image/png' } }));
  await h.worker.run(h.deps);
  const payload = h.execute.mock.calls.find(([call]) => call.args[0] === 'prepare')?.[0].args[1] as { imageMime: string; imageBase64: string };
  expect(payload.imageMime).toBe('image/png');
  expect(payload.imageBase64).toHaveLength(4 * Math.ceil(limitBytes / 3));
  expect(h.execute.mock.calls.filter(([call]) => call.args[0] === 'send')).toHaveLength(1);
  expect(h.stored.commentJournal).toBeUndefined();
});

 it("wakes at the remaining group cooldown instead of waiting for the next minute poll", async () => {
  const h = harness();
  h.postJson.mockResolvedValue({ ok: true, json: async () => ({ job: null, retryAfterMs: 17000 }) });
  await h.worker.drain(h.deps);
  expect(h.alarms.create).toHaveBeenCalledWith("mybot-comment-due", { when: h.now() + 17000 });
  expect(h.tabs.create).not.toHaveBeenCalled();
});
 it("does not schedule invalid or immediate server retry loops", async () => {
  for (const retryAfterMs of [null, -1, 0, "17000"]) {
    const h = harness();
    h.postJson.mockResolvedValue({ ok: true, json: async () => ({ job: null, retryAfterMs }) });
    await h.worker.drain(h.deps);
    expect(h.alarms.create).not.toHaveBeenCalled();
  }
});

it("keeps successive one-minute dispatches flowing through server deferrals", async () => {
  const h = harness(); const original = h.postJson.getMockImplementation()!;
  const dispatched: number[] = [];
  let nextAt = h.now();
  h.postJson.mockImplementation(async (cfg, path, body) => {
    if (body.action === "claim" && h.now() < nextAt) {
      return { ok: true, json: async () => ({ job: null, retryAfterMs: nextAt - h.now() }) };
    }
    if (body.action === "authorize") {
      dispatched.push(h.now()); nextAt = h.now() + 60000;
    }
    return original(cfg, path, body);
  });
  for (let i = 0; i < 5; i++) {
    await h.worker.drain(h.deps);
    expect(h.alarms.create).toHaveBeenLastCalledWith("mybot-comment-due", { when: nextAt });
    h.advance(nextAt - h.now());
  }
  expect(dispatched).toHaveLength(5);
  expect(dispatched.slice(1).map((at, i) => at - dispatched[i])).toEqual([60000, 60000, 60000, 60000]);
  expect(h.execute.mock.calls.filter(([call]) => call.args[0] === "send")).toHaveLength(5);
});
