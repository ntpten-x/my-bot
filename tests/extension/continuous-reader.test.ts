/* eslint-disable @typescript-eslint/no-explicit-any -- The VM executes untyped extension JavaScript against dynamically shaped Chrome storage fixtures. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const scrape = createRequire(import.meta.url)("../../extension/scrape.js");
const source = readFileSync("extension/background.js", "utf8");
const url = "https://www.facebook.com/groups/12345";
const cfg = { apiBase: "https://owner.example", token: "synthetic", paused: false };
const group = { id: "source", url, needsCoverage: true };
const NOW = Date.parse("2026-11-07T12:00:00Z");
const post = (id: number) => ({ url: `${url}/posts/${id}`, text: `synthetic ${id}`, postedAt: new Date(NOW - 3600_000).toISOString() });
type Page = { posts: ReturnType<typeof post>[]; loading?: boolean; checkpoint?: boolean; identity?: { loggedIn: boolean; id?: string }; endOfFeed?: boolean };
type Storage = Record<string, any>;

// Execute the real readFeed, scrapeGroup, continuation storage, outbox and receipt loop.
// Only Chrome/UI and the HTTP transport are synthetic; no database or Facebook sends.
function harness(pages: Page[], local: Storage = {}, session: Storage = {}) {
  let now = NOW;
  let nextTab = 1;
  let offline = false;
  let rejectOutbox = false;
  let paused = false;
  let sleepJump = 0;
  let reloadPages: Page[] | null = null;
  let lookupWait: Promise<void> | undefined;
  let lookupEntered: (() => void) | undefined;
  const tabs = new Map<number, { id: number; url: string; cursor: number; windowId: number; ephemeral: boolean }>();
  const accepted = new Map<string, number>();
  const sent: number[] = [];
  const events: string[] = [];
  const errors: string[] = [];
  const storage = (data: Storage) => ({
    get: async (defaults: Storage) => ({ ...structuredClone(defaults), ...structuredClone(data) }),
    set: async (value: Storage) => {
      if (rejectOutbox && "outbox" in value) throw new Error("synthetic storage failure");
      Object.assign(data, structuredClone(value));
    },
  });
  const openReader = vi.fn(async (target: string) => {
    const tab = { id: nextTab++, url: target, cursor: 0, windowId: 1, ephemeral: true };
    tabs.set(tab.id, tab);
    events.push("open");
    return { tabId: tab.id, windowId: 1, ephemeral: true };
  });
  const reload = vi.fn(async (id: number) => {
    tabs.get(id)!.cursor = 0;
    if (reloadPages) { pages = reloadPages; reloadPages = null; }
    events.push("reload");
  });
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    Date: Clock, Math, Set, Map, URL, Promise, setTimeout, clearTimeout, crypto: globalThis.crypto, BOOT_ID: "new-boot", READER_MAX_AGE_MS: 900000,
    cycling: false, scrapingTabs: new Set(), activeReaderTabs: new Set(), MyBotScrape: scrape,
    chrome: { storage: { local: storage(local), session: storage(session) },
      runtime: { getManifest: () => ({ version: "1.11.0" }) }, windows: { get: async () => ({ state: "normal" }) },
      tabs: { get: async (id: number) => { if (lookupWait) { lookupEntered?.(); await lookupWait; } const tab = tabs.get(id); if (!tab) throw Error("missing tab"); return { ...tab, status: "complete" }; },
        reload, remove: async (id: number) => { tabs.delete(id); }, update: async () => {} },
    },
    base: () => cfg.apiBase, loadConfig: async () => ({ ...cfg, paused, schedules: local.schedules || { source: now + 30000 } }), currentFbUserId: async () => "12345",
    sourceKind: () => "group", scrapeSettingsFor: async () => scrape.scrapeSettings({ scrollScreens: 1, maxPostsPerRun: 40 }),
    sleep: async (ms: number) => { now += ms + sleepJump; }, waitComplete: async () => {}, injectReaders: async () => {},
    waitForGrowth: async (id: number) => ({ count: pages[Math.min(tabs.get(id)!.cursor, pages.length - 1)].posts.length, grew: false }),
    readPage: async (id: number) => structuredClone(pages[Math.min(tabs.get(id)!.cursor, pages.length - 1)]),
    scrollOneScreen: async (id: number) => { tabs.get(id)!.cursor++; events.push("scroll"); },
    nudgeScroll: async () => {}, wakeReaderTab: async () => { events.push("wake"); }, withReaderForeground: async (_reader: unknown, work: () => Promise<unknown>) => work(),
    shouldAbortDeadFeed: scrape.shouldAbortDeadFeed, rememberIdentity: async () => {}, quietReason: async () => "",
    readerWindowState: () => "normal", openReader, loadScrapeWindow: async () => null,
    heartbeat: async () => {}, noteSweepAt: vi.fn(), updateFullTextBacklog: async (fn: (data: Storage) => void) => fn({}),
    rememberError: async (message: string) => errors.push(message), reportRun: vi.fn(async () => null), countSent: async () => {},
    RETRY_STATUS: new Set([408, 429, 503]),
    postJson: async (_cfg: unknown, path: string, body: Storage) => {
      if (path !== "/api/v1/ingest") return { ok: true };
      if (offline) return { status: 503, ok: false };
      const receipts = body.posts.map((p: ReturnType<typeof post> & {itemId: string}) => {
        const key = scrape.postKey(p.url);
        if (!accepted.has(key)) { accepted.set(key, accepted.size + 1); sent.push(Number(key.slice(2))); }
        return { itemId: p.itemId, outcome: "accepted" };
      });
      return { ok: true, status: 200, json: async () => ({ batchId: body.batchId, receipts, inserted: receipts.length }) };
    },
  });
  // Pure helpers must share the VM clock, so dated fixtures do not age with wall time.
  vm.runInContext(readFileSync("extension/scrape.js", "utf8"), context);
  vm.runInContext(readFileSync("extension/focus.js", "utf8"), context);
  vm.runInContext(readFileSync("extension/tab-lifecycle.js", "utf8"), context);
  vm.runInContext(source.slice(source.indexOf("const OUTBOX_MAX ="), source.indexOf("async function countSent")), context);
  vm.runInContext(source.slice(source.indexOf("async function closeOrphanReaders("), source.indexOf("async function openReader(")), context);
  vm.runInContext(source.slice(source.indexOf("function sameReaderUrl("), source.indexOf("// Scroll and read one feed")), context);
  vm.runInContext(source.slice(source.indexOf("async function readFeed("), source.indexOf("async function processFullTextQueue(")), context);
  return {
    local, session, tabs, accepted, sent, events, errors, openReader, reload, active: context.activeReaderTabs as Set<number>,
    reports: context.reportRun as ReturnType<typeof vi.fn>,
    pause: () => { paused = true; }, offline: (value: boolean) => { offline = value; }, rejectOutbox: (value: boolean) => { rejectOutbox = value; },
    slowSleep: (value = 100_000) => { sleepJump = value; },
    onReload: (value: Page[]) => { reloadPages = value; },
    setPages: (value: Page[]) => { pages = value; },
    now: () => now,
    advance: (ms: number) => { now += ms; },
    run: (target = group, options = {freshness:false}) => (context.scrapeGroup as any)(cfg, target, {}, options),
    claim: () => context.loadContinuation(cfg, group, scrape.scrapeUrl(group.url, "group"), { claim: true }),
    blockLookup: () => {
      let release!: () => void;
      const entered = new Promise<void>(resolve => { lookupEntered = resolve; });
      lookupWait = new Promise<void>(resolve => { release = () => { lookupWait = undefined; resolve(); }; });
      return { entered, release };
    },
    recover: (options = {}) => (context.closeOrphanReaders as any)(options),
    flush: () => (context.flushOutbox as any)(cfg),
  };
}

describe("continuous read-only collection", () => {
  it("releases a far-future reader only after validating its durable recovery", async () => {
    const h = harness(Array.from({ length: 100 }, (_, i) => ({ posts: [post(i * 3 + 1), post(i * 3 + 2), post(i * 3 + 3)] })));
    await h.run();
    const recovery = structuredClone(h.local.coverageRecovery);
    h.local.schedules = { source: h.now() + 90001 };
    await h.recover();
    expect(h.tabs.size).toBe(0); expect(h.local.coverageRecovery).toEqual(recovery);
    await h.run(); expect(h.accepted.size).toBeGreaterThan(0);
  });
  it("keeps a parked reader when the latest pending snapshot is missing from durable recovery", async () => {
    const h = harness(Array.from({ length: 100 }, (_, i) => ({ posts: [post(i * 3 + 1), post(i * 3 + 2), post(i * 3 + 3)] })));
    await h.run();
    const reader: any = Object.values(h.session.readers)[0];
    reader.continuation.run.fresh = [post(999)];
    h.local.schedules = { source: h.now() + 90001 };
    await h.recover();
    expect(h.tabs.has(reader.tabId)).toBe(true);
    h.advance(6 * 60_000); h.pause(); await h.recover({ parked: true });
    expect(h.tabs.has(reader.tabId)).toBe(true);
  });
  it("releases an abandoned parked tab after five minutes, retaining durable recovery", async () => {
    const h = harness(Array.from({ length: 100 }, (_, i) => ({ posts: [post(i * 3 + 1), post(i * 3 + 2), post(i * 3 + 3)] })));
    await h.run();
    expect(h.tabs.size).toBe(1);
    const recovery = structuredClone(h.local.coverageRecovery);
    h.advance(5 * 60_000 + 1);
    await h.recover();
    expect(h.tabs.size).toBe(0);
    expect(h.local.coverageRecovery).toEqual(recovery);
  });
  it("explicit cleanup releases parked tabs immediately without dropping pending posts", async () => {
    const h = harness(Array.from({ length: 100 }, (_, i) => ({ posts: [post(i * 3 + 1), post(i * 3 + 2), post(i * 3 + 3)] })));
    await h.run();
    const recovery = structuredClone(h.local.coverageRecovery);
    await h.recover({ parked: true });
    expect(h.tabs.size).toBe(0);
    expect(h.local.coverageRecovery).toEqual(recovery);
  });
  it("never expires a reader while its current pass is active", async () => {
    const h = harness(Array.from({ length: 100 }, (_, i) => ({ posts: [post(i * 3 + 1), post(i * 3 + 2), post(i * 3 + 3)] })));
    await h.run();
    const reader: any = Object.values(h.session.readers)[0];
    h.active.add(reader.tabId);
    h.advance(6 * 60_000);
    await h.recover({ parked: true });
    expect(h.tabs.size).toBe(1);
  });
  it("serializes resuming a cursor against simultaneous explicit cleanup", async () => {
    const h = harness(Array.from({ length: 100 }, (_, i) => ({ posts: [post(i * 3 + 1), post(i * 3 + 2), post(i * 3 + 3)] })));
    await h.run();
    const gate = h.blockLookup();
    const claim = h.claim();
    await gate.entered;
    const cleanup = h.recover({ parked: true });
    gate.release();
    const resumed = await claim;
    await cleanup;
    expect(resumed).not.toBeNull();
    expect(h.tabs.size).toBe(1);
    expect(h.active.has(resumed.reader.tabId)).toBe(true);
  });
  it("uses the caller's deadline and verifies no progress across short slices", async () => {
    const h = harness([{posts:[post(1),post(2),post(3)]}]);
    let result;
    for(let i=0;i<8 && (!result || h.tabs.size);i++) {
      const started=h.now();
      result=await h.run(group,{deadlineMs:started+16_000});
      expect(h.now()-started).toBeLessThanOrEqual(16_000);
    }
    expect(result.stoppedBy).toBe("exhausted");
    expect(h.accepted.size).toBe(3);
    expect(h.openReader).toHaveBeenCalledTimes(1);
  });
  it("marks a time-budget yield incomplete even after productive reads, without reloading", async () => {
    const h = harness([{posts:[post(1),post(2),post(3)]},{posts:[post(4),post(5),post(6)]}]);
    h.slowSleep();
    const result=await h.run();
    expect(result.stoppedBy).toBe("limit");
    expect(result.stats.hitLimit).toBe(true);
    expect(result.scrolls).toBeLessThan(3);
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.local.outbox.flatMap((item:any)=>item.posts)).toHaveLength(3);
    expect(h.tabs.size).toBe(1);
    h.slowSleep(0); await h.run();
    expect(h.accepted.size).toBe(6);
  });

  it("stops reading while the durable outbox is blocked", async () => {
    const h = harness([{posts:[post(1),post(2),post(3)]}],{outboxBlocked:true,outbox:[]});
    const result=await h.run();
    expect(result.stoppedBy).toBe("yield");
    expect(h.accepted.size).toBe(0);
    expect(h.events).not.toContain("scroll");
  });
  it("accepts an empty feed only after repeated explicit end signals", async () => {
    const h = harness([{posts:[],endOfFeed:true}]);
    const result = await h.run();
    expect(result.stoppedBy).toBe("exhausted");
    expect(result.stats.hitLimit).toBe(false);
    expect(h.local.coverageRecovery).toEqual({});
    expect(h.reload).not.toHaveBeenCalled();
  });
  it("drains beyond the 200-post ceiling, resumes the same tab and eventually confirms no growth", async () => {
    const pages = Array.from({ length: 45 }, (_, screen) => ({ posts: Array.from({length: 8}, (_, i) => post(screen * 8 + i + 1)) }));
    const h = harness(pages);
    let result = await h.run();
    expect(result.ok).toBe(true);
    expect(result.stoppedBy).toBe("limit");
    expect(result.stats.hitLimit).toBe(true);
    expect(h.accepted.size).toBeGreaterThan(0);
    expect(h.reload).not.toHaveBeenCalled();
    for (let round = 0; round < 5 && h.tabs.size; round++) result = await h.run();
    expect(h.accepted.size).toBe(360);
    expect(h.openReader).toHaveBeenCalledTimes(1);
    expect(h.tabs.size).toBe(0);
    expect(result.stoppedBy).toBe("exhausted");
    expect(h.local.coverageRecovery).toEqual({});
  });

  it("does not lose a DOM snapshot larger than the batch size", async () => {
    const h = harness([{posts: Array.from({length: 250}, (_, i) => post(i + 1))}]);
    await h.run();
    expect(h.accepted.size).toBe(250);
    expect(h.local.outbox).toEqual([]);
  });

  it("preserves first-pass captures when reload discovers a different set", async () => {
    const h = harness([{posts:[post(1)], loading:true}]);
    h.onReload([{posts:[post(2),post(3),post(4)]}]);
    // First pass is productive: send it first, recover the stalled DOM on the next slice.
    await h.run();
    for (let i = 0; i < 3 && !h.accepted.has("p:4"); i++) await h.run();
    expect([...h.accepted.keys()].sort()).toEqual(["p:1","p:2","p:3","p:4"]);
  });

  it("recycles a DOM stalled for three slices but keeps recovery for the next deep pass", async () => {
    const h = harness([{ posts: [], loading: true }]);
    await h.run(); await h.run();
    expect(h.tabs.size).toBe(1);
    await h.run();
    expect(h.tabs.size).toBe(0);
    expect(Object.keys(h.local.coverageRecovery)).toHaveLength(1);
    h.setPages([{ posts: [post(1), post(2), post(3)] }]);
    await h.run();
    expect(h.openReader).toHaveBeenCalledTimes(2);
    expect([...h.accepted.keys()].sort()).toEqual(["p:1", "p:2", "p:3"]);
  });
  it("does not recycle a deep cursor making progress through already known posts", async () => {
    const pages = Array.from({ length: 200 }, (_, index) => ({ posts: [post(index * 3 + 1), post(index * 3 + 2), post(index * 3 + 3)] }));
    const h = harness(pages);
    const target = { ...group, knownKeys: pages.flatMap(page => page.posts.map(post => scrape.postKey(post.url))) };
    await h.run(target); await h.run(target); await h.run(target);
    expect(h.openReader).toHaveBeenCalledTimes(1);
    expect(h.accepted.size).toBe(0);
    expect(Object.values(h.session.readers)[0]).toMatchObject({ stalledSlices: 0 });
  });

  it("adopts parked readers after a service-worker boot change", async () => {
    const h = harness(Array.from({length:50}, (_, i) => ({posts:[post(i*3+1),post(i*3+2),post(i*3+3)]})));
    await h.run();
    const saved: any = Object.values(h.session.readers)[0];
    saved.boot = "previous-boot";
    const before = h.accepted.size;
    await h.recover();
    await h.run();
    expect(h.openReader).toHaveBeenCalledTimes(1);
    expect(h.accepted.size).toBeGreaterThan(before);
  });

  it("recovers captured posts across a full browser restart even if the outbox write failed", async () => {
    const local: Storage = {};
    const h = harness([{posts:[post(1),post(2),post(3)]}], local);
    h.rejectOutbox(true);
    expect((await h.run()).ok).toBe(false);
    expect((Object.values(local.coverageRecovery)[0] as any).pending).toHaveLength(3);
    const restarted = harness([{posts:[post(4),post(5),post(6)]}], local);
    await restarted.run();
    expect([...restarted.accepted.keys()].sort()).toEqual(["p:1","p:2","p:3","p:4","p:5","p:6"]);
  });

  it("retains queued data offline, then removes it only after server receipts", async () => {
    const h = harness([{posts:[post(1),post(2),post(3)]}]);
    h.offline(true);
    await h.run();
    expect(h.local.outbox.flatMap((item: any) => item.posts)).toHaveLength(3);
    h.offline(false);
    await h.flush();
    expect(h.local.outbox).toEqual([]);
    expect(h.accepted.size).toBe(3);
  });

  it.each(["checkpoint", "logged_out"])("stops for %s without ingesting the displayed articles", async reason => {
    const h = harness([{posts:[post(1),post(2),post(3)], ...(reason === "checkpoint" ? {checkpoint:true} : {identity:{loggedIn:false}})}]);
    const result = await h.run();
    expect(result.ok).toBe(false);
    expect(result.stoppedBy).toBe(reason);
    expect(h.accepted.size).toBe(0);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("checks fresh head posts without losing the parked historical cursor", async () => {
    const pages = Array.from({length:100}, (_, i) => ({posts:[post(i*3+1),post(i*3+2),post(i*3+3)]}));
    const h = harness(pages);
    await h.run(group, {freshness:true});
    const historical = [...h.tabs.values()][0];
    const cursor = historical.cursor;
    pages[0] = {posts:[post(999),post(1),post(2)]};
    h.advance(61_000);
    const started=h.now();
    await h.run(group, {freshness:true});
    expect(h.now()-started).toBeLessThanOrEqual(45_000);
    expect(h.reports).toHaveBeenCalledTimes(2); // Latest checks never replace coverage reports.
    expect(h.accepted.has("p:999")).toBe(true);
    expect(h.tabs.get(historical.id)?.cursor).toBeGreaterThan(cursor);
    expect(h.openReader).toHaveBeenCalledTimes(2);
    expect(Object.values(h.session.readers).filter((r:any)=>r.continuation)).toHaveLength(1);
  });

  it("keeps a history turn when the available deadline cannot fit both lanes", async () => {
    const pages=Array.from({length:100},(_,i)=>({posts:[post(i*3+1),post(i*3+2),post(i*3+3)]}));
    const h=harness(pages); await h.run(group,{freshness:true}); h.advance(61_000);
    const tab=[...h.tabs.values()][0]; const before=tab.cursor;
    await h.run(group,{freshness:true,deadlineMs:h.now()+25_000});
    expect(h.openReader).toHaveBeenCalledTimes(1);
    expect(tab.cursor).toBeGreaterThan(before);
  });
  it("does not reopen the latest feed on every continuation tick", async () => {
    const h=harness(Array.from({length:100},(_,i)=>({posts:[post(i*3+1),post(i*3+2),post(i*3+3)]})));
    await h.run(group,{freshness:true});
    await h.run(group,{freshness:true});
    expect(h.openReader).toHaveBeenCalledTimes(1);
  });
  it("preserves latest captures after failed outbox writes and a full restart", async () => {
    const pages=Array.from({length:100},(_,i)=>({posts:[post(i*3+1),post(i*3+2),post(i*3+3)]}));
    const h=harness(pages); await h.run(group,{freshness:true});
    pages[0]={posts:[post(999),post(1),post(2)]}; h.advance(61_000); h.rejectOutbox(true);
    expect((await h.run(group,{freshness:true})).ok).toBe(false);
    expect(Object.values(h.local.headRecovery).flatMap((r:any)=>r.pending).some((p:any)=>p.url.endsWith('/999'))).toBe(true);
    expect(Object.values(h.session.readers).filter((r:any)=>r.continuation)).toHaveLength(1);
    const restarted=harness([{posts:[post(800),post(801),post(802)]}],h.local);
    await restarted.run();
    expect(restarted.accepted.has('p:999')).toBe(true);
    expect(restarted.local.headRecovery).toEqual({});
  });
  it("looks past known pinned head posts to capture newly inserted posts", async () => {
    const pages=Array.from({length:100},(_,i)=>({posts:[post(i*3+1),post(i*3+2),post(i*3+3)]}));
    const h=harness(pages); await h.run(group,{freshness:true});
    pages[1]={posts:[post(999),post(4),post(5)]}; h.advance(61_000);
    await h.run({...group,knownKeys:['p:1','p:2','p:3']},{freshness:true});
    expect(h.accepted.has('p:999')).toBe(true);
    expect(h.sent.filter(id=>id===999)).toHaveLength(1);
  });

  it("yields discovery while a comment owns focus without reading another DOM snapshot",async()=>{
    const h=harness([{posts:[post(1),post(2),post(3)]}]);
    h.session.commentFocusLease={owner:'comment',until:NOW+60000};
    const result=await h.run();
    expect(result.stoppedBy).toBe('yield');expect(h.accepted.size).toBe(0);expect(h.events).not.toContain('scroll');
  });
  it("honors pause before a resumed reader observes more posts", async () => {
    const h = harness(Array.from({length:50}, (_, i) => ({posts:[post(i*3+1),post(i*3+2),post(i*3+3)]})));
    await h.run(); const before = h.accepted.size;
    h.pause(); await h.run();
    expect(h.accepted.size).toBe(before);
    expect(h.tabs.size).toBe(1);
  });
});

it("ages overdue groups and reserves a turn for healthy groups among coverage backlog", () => {
  const groups = [1,2,3,4].map(id => ({id:String(id),needsCoverage:true}));
  expect(scrape.orderDueGroups([...groups, {id:"healthy",needsCoverage:false}]).slice(0,3).map((g:any)=>g.id)).toContain("healthy");
  const overdue = {id:"overdue",needsCoverage:false,nextRunAt:new Date(NOW-3600_000).toISOString(),intervalMinutes:3};
  expect(scrape.orderDueGroups([...groups,overdue],{now:NOW})[0].id).toBe("overdue");
});

it("restores Infinity, sets and counters from storage without re-emitting captured posts", () => {
  const run = scrape.createRun({knownStreak:Infinity,now:NOW});
  scrape.addStep(run,[post(1),post(2),post(3)]);
  const restored = scrape.restoreRun(JSON.parse(JSON.stringify(scrape.snapshotRun(run))));
  scrape.resumeRun(restored,NOW);
  scrape.addStep(restored,[post(1),post(4)]);
  expect(restored.knownStreak).toBe(Infinity);
  expect(restored.newCount).toBe(4);
  expect(restored.fresh).toHaveLength(4);
});
