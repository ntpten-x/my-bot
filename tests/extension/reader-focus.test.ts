import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
const source = readFileSync('extension/background.js', 'utf8');
function harness() {
  const owner = { id: 1, type: 'normal', focused: true, state: 'normal', tabs: [{ id: 10, windowId: 1, active: true, url: 'http://localhost:8001' }, { id: 11, windowId: 1, active: false, url: 'https://www.facebook.com/' }] };
  const windows = new Map<number, any>([[1, owner]]);
  const session: any = {};
  const local: any = {};
  const updates = vi.fn(async (id: number, value: any) => {
    for (const win of windows.values()) for (const tab of win.tabs) if (tab.id === id) {
      if (value.active) win.tabs.forEach((t: any) => { t.active = t.id === id; });
      Object.assign(tab, value); return tab;
    }
    throw Error('missing tab');
  });
  const chrome = {
    storage: { local: {get: async (defaults:any)=>({...defaults,...local})}, session: { get: async (defaults: any) => ({...defaults,...session}), set: async (v: any) => Object.assign(session,v), remove: async (key: string) => {delete session[key];} } },
    tabs: { query: async (q: any) => [...windows.values()].flatMap(w=>w.tabs).filter(t=>(q.windowId === undefined || t.windowId===q.windowId) && (!q.active || t.active) && (!q.url || /facebook/.test(t.url))),
      get: async (id: number) => [...windows.values()].flatMap(w=>w.tabs).find(t=>t.id===id), update: updates,
      remove: vi.fn(async (id: number) => { for (const win of windows.values()) win.tabs = win.tabs.filter((tab: { id: number }) => tab.id !== id); }),
      create: async (v: any) => { const tab={id:100+[...windows.values()].flatMap(w=>w.tabs).length,...v}; windows.get(v.windowId).tabs.push(tab); return tab; } },
    windows: { WINDOW_ID_NONE: -1, get: async (id: number) => {if(!windows.has(id)) throw Error('missing'); return windows.get(id);},
      create: vi.fn(async (v: any) => { const id=Math.max(...windows.keys())+1; const win={id,type:'normal',state:'normal',focused:false,tabs:[{id:20+(id-2)*1000,windowId:id,url:v.url,active:true}]}; windows.set(id,win); return win; }),
      update: vi.fn(async (id: number, v: any) => Object.assign(windows.get(id),v)), onRemoved:{addListener:()=>{}},onFocusChanged:{addListener:()=>{}} },
  };
  const context = vm.createContext({chrome,Date,Math,URL,Set,Promise,setTimeout,clearTimeout,scrapingTabs:new Set(),activeReaderTabs:new Set(),cycling:false,
    loadConfig:async()=>({apiBase:'https://owner.example'}),base:(cfg:{apiBase:string})=>cfg.apiBase,currentFbUserId:async()=>'12345',
    sleep:async()=>{},withScrapeWindowLock:async(fn:any)=>fn()});
  vm.runInContext(readFileSync('extension/focus.js','utf8'),context);
  vm.runInContext(readFileSync("extension/tab-lifecycle.js", "utf8"), context);
  vm.runInContext(source.slice(source.indexOf('/** Activate only'),source.indexOf('// Lazy loading stalled')),context);
  vm.runInContext(source.slice(source.indexOf('const BOOT_ID ='),source.indexOf('async function closeOrphanReaders(')),context);
  vm.runInContext(source.slice(source.indexOf('async function openReader('),source.indexOf('function sameReaderUrl(')),context);
  vm.runInContext(source.slice(source.indexOf('async function closeOrphanReaders('),source.indexOf('async function openReader(')),context);
  vm.runInContext(source.slice(source.indexOf('function sameReaderUrl('),source.indexOf('// Scroll and read one feed')),context);
  vm.runInContext(source.slice(source.indexOf('function isFacebookTab('),source.indexOf('async function quietReason(')),context);
  return { owner, windows, session, local, chrome, updates, context, open:async()=> { const reader=await context.openReader('https://www.facebook.com/groups/123',true); context.activeReaderTabs.delete(reader.tabId); return reader; } };
}
it('keeps MY-BOT selected during deep collection and wake pulses',async()=>{
  const h=harness(); const reader=await h.open();
  await (h.context.withReaderForeground as any)(reader,async()=>expect(h.owner.tabs[0].active).toBe(true));
  await (h.context.wakeReaderTab as any)(reader,400);
  expect(h.owner.tabs[0].active).toBe(true);
  expect(reader.windowId).not.toBe(1);
  expect(h.chrome.windows.create).toHaveBeenCalledWith(expect.objectContaining({focused:false,type:'normal'}));
  expect(h.updates.mock.calls.some(([id,v])=> v.active && [10,11].includes(id))).toBe(false);
});

it('closes the unused reader and blank container without touching personal tabs',async()=>{
  const h=harness();const reader=await h.open();
  await h.context.closeReader(reader);
  expect(h.chrome.tabs.remove).toHaveBeenCalledWith(reader.tabId);
  expect(h.chrome.tabs.remove).toHaveBeenCalledWith(20);
  expect(h.session.scrapeWindow).toBeNull();
  expect(h.owner.tabs.map((tab:{id:number})=>tab.id)).toEqual([10,11]);
});

it('keeps the container while another reader still needs it',async()=>{
  const h=harness();const first=await h.open();const second=await h.open();
  await h.context.closeReader(first);
  expect(h.chrome.tabs.remove).not.toHaveBeenCalledWith(20);
  expect(h.session.readers[String(second.tabId)]).toBeDefined();
});

it('preserves personal tabs moved into the collector window when work finishes',async()=>{
  const h=harness();const reader=await h.open();
  h.windows.get(2).tabs.push({id:99,windowId:2,url:'https://example.com',active:true});
  await h.context.closeReader(reader);
  expect(h.windows.get(2).tabs.map((tab:{id:number})=>tab.id)).toEqual([99]);
  expect(h.chrome.tabs.remove).not.toHaveBeenCalledWith(99);
});

it('remembers old blank containers after switching to a new window and keeps personal tabs',async()=>{
  const h=harness();const first=await h.open();
  h.windows.get(2).tabs.push({id:99,windowId:2,url:'https://example.com/personal',active:true});
  const second=await h.open();expect(second.windowId).toBe(3);
  await h.context.closeReader(first);await h.context.closeReader(second);
  expect(h.chrome.tabs.remove).toHaveBeenCalledWith(20);
  expect(h.chrome.tabs.remove).toHaveBeenCalledWith(1020);
  expect(h.chrome.tabs.remove).not.toHaveBeenCalledWith(99);
  expect(h.windows.get(2).tabs.map((tab:{id:number})=>tab.id)).toEqual([99]);
  expect(h.session.scrapeContainers).toEqual({});
});

it('retries a failed close on the next cleanup rather than forgetting the tab',async()=>{
  const h=harness();const reader=await h.open();
  h.chrome.tabs.remove.mockRejectedValueOnce(new Error('temporary browser error'));
  await h.context.closeReader(reader);
  expect(h.session.readers[String(reader.tabId)]).toMatchObject({closing:true});
  h.session.readers[String(reader.tabId)].closeAfter=0;
  await h.context.closeOrphanReaders();
  expect(h.session.readers[String(reader.tabId)]).toBeUndefined();
  expect(h.chrome.tabs.remove).toHaveBeenCalledWith(20);
});

it('does not forget a reader after temporary lookup failure and respects retry spacing',async()=>{
  const h=harness();const reader=await h.open();
  const get=h.chrome.tabs.get;h.chrome.tabs.get=async()=>{throw Error('temporary');};
  await h.context.closeReader(reader);
  expect(h.session.readers[String(reader.tabId)]).toMatchObject({closing:true,closeAttempts:1});
  h.chrome.tabs.get=get;
  await h.context.closeOrphanReaders();
  expect(h.chrome.tabs.remove).not.toHaveBeenCalledWith(reader.tabId);
  h.session.readers[String(reader.tabId)].closeAfter=0;
  await h.context.closeOrphanReaders();
  expect(h.chrome.tabs.remove).toHaveBeenCalledWith(reader.tabId);
});

it('keeps the blank container reference when lookup is unknown and retries it later',async()=>{
  const h=harness();await h.open();
  h.session.readers={};
  const get=h.chrome.tabs.get;h.chrome.tabs.get=async()=>{throw Error('temporary');};
  await h.context.closeIdleScrapeWindow({});
  expect(h.session.scrapeWindow).toMatchObject({tabId:20,closing:true});
  h.chrome.tabs.get=get;h.session.scrapeWindow.closeAfter=0;
  await h.context.closeIdleScrapeWindow({});
  expect(h.chrome.tabs.remove).toHaveBeenCalledWith(20);
});

it.each(['success','timeout','outbox-full','offline'])('runs full-text open/read/close end to end: %s',async(outcome)=>{
  const h=harness(); const target='https://www.facebook.com/groups/123/posts/8888/';
  const backlog:Record<string,unknown>={[target]:{groupId:'g',addedAt:1}};
  const durable:unknown[]=[];
  Object.assign(h.context,{fullTextBudget:10,FULL_TEXT_BUDGET_MS:30000,postKey:(url:string)=>url,
    loadConfig:async()=>({apiBase:'https://owner.example',token:'synthetic'}),
    loadFullTextBacklog:async()=>backlog,updateFullTextBacklog:async(fn:any)=>fn(backlog),
    sourceKind:()=> 'group',cleanPost:(post:unknown)=>post,
    waitComplete:async()=>{if(outcome==='timeout')throw Error('synthetic timeout');},injectReaders:async()=>{},
    readPage:async()=>({posts:[{url:target,text:'synthetic full text',truncated:false}]}),
    sendPosts:async(_cfg:unknown,_url:string,posts:unknown[])=>{if(outcome==='outbox-full')throw Error('storage full');durable.push(...posts);return outcome==='offline'?null:{ok:true};},
  });
  h.chrome.storage.local.get=async(defaults:any)=>({...defaults,...h.local});
  (h.chrome.storage.local as any).set=async(value:object)=>Object.assign(h.local,value);
  vm.runInContext(source.slice(source.indexOf('async function readFullTexts('),source.indexOf('async function waitForGrowth(')),h.context);
  vm.runInContext(source.slice(source.indexOf('async function processFullTextQueue('),source.indexOf('let cycling = false;')),h.context);
  await h.context.processFullTextQueue({apiBase:'https://owner.example',token:'synthetic'},[{id:'g',url:'synthetic'}]);
  expect(Object.keys(h.session.readers)).toHaveLength(0);
  expect(h.windows.get(2).tabs).toHaveLength(0);
  expect(h.owner.tabs.map((tab:{id:number})=>tab.id)).toEqual([10,11]);
  expect(h.updates).not.toHaveBeenCalled(); // Initial navigation is reused, never reloaded.
  expect(h.context.activeReaderTabs.size).toBe(0);
  if(['timeout','outbox-full'].includes(outcome))expect(backlog[target]).toBeDefined();
  else {expect(backlog[target]).toBeUndefined();expect(durable).toHaveLength(1);}
});

it('preserves a reader tab navigated by the owner and removes only the empty container',async()=>{
  const h=harness();const reader=await h.open();
  await h.chrome.tabs.update(reader.tabId,{url:'https://example.com/owner-page'});
  await h.context.closeReader(reader);
  expect(h.chrome.tabs.remove).not.toHaveBeenCalledWith(reader.tabId);
  expect(h.chrome.tabs.remove).toHaveBeenCalledWith(20);
  expect(h.session.readers[String(reader.tabId)]).toBeUndefined();
});

it('keeps a parked continuation and an active reader during heartbeat cleanup',async()=>{
  const h=harness();const reader=await h.open();const active=await h.open();
  h.session.readers[String(reader.tabId)].continuation={url:reader.url,apiBase:'https://owner.example',fbUserId:'12345'};
  h.session.readers[String(active.tabId)].at=Date.now()-3*3600000;
  h.context.activeReaderTabs.add(active.tabId);
  await h.context.closeOrphanReaders();
  expect(h.chrome.tabs.remove).not.toHaveBeenCalled();
  expect(Object.keys(h.session.readers)).toHaveLength(2);
});

it('manual cleanup releases only idle owned readers and preserves active and parked cursors',async()=>{
  const h=harness();const idle=await h.open();const active=await h.open();const parked=await h.open();
  h.context.activeReaderTabs.add(active.tabId);
  h.session.readers[String(parked.tabId)].continuation={url:parked.url,apiBase:'https://owner.example',fbUserId:'12345'};
  await h.context.closeOrphanReaders({unused:true});
  expect(h.chrome.tabs.remove).toHaveBeenCalledWith(idle.tabId);
  expect(h.chrome.tabs.remove).not.toHaveBeenCalledWith(active.tabId);
  expect(h.chrome.tabs.remove).not.toHaveBeenCalledWith(parked.tabId);
});

it('does not close a bot tab moved into the owner window even at the same URL',async()=>{
  const h=harness();const reader=await h.open();const win=h.windows.get(2);
  const tab=win.tabs.find((tab:{id:number})=>tab.id===reader.tabId);win.tabs=win.tabs.filter((tab:{id:number})=>tab.id!==reader.tabId);
  tab.windowId=1;h.owner.tabs.push(tab);
  await h.context.closeReader(reader);
  expect(h.chrome.tabs.remove).not.toHaveBeenCalledWith(reader.tabId);
  expect(h.session.tabCleanup.released).toBe(1);
});

it('bounds allocations when closing readers already fill the pool',async()=>{
  const h=harness();await h.open();
  h.session.readers=Object.fromEntries(Array.from({length:22},(_,i)=>[String(i),{tabId:i,closing:true}]));
  await expect(h.open()).rejects.toThrow('รอปิดแท็บบอท');
});

it('releases paused parked tabs without deleting their durable pending recovery',async()=>{
  const h=harness();const reader=await h.open();
  h.session.readers[String(reader.tabId)].continuation={url:reader.url,apiBase:'https://owner.example',fbUserId:'12345'};
  h.local.coverageRecovery={pending:{posts:['synthetic']}};
  h.context.loadConfig=async()=>({apiBase:'https://owner.example',paused:true});
  await h.context.closeOrphanReaders();
  expect(h.chrome.tabs.remove).toHaveBeenCalledWith(reader.tabId);
  expect(h.local.coverageRecovery).toEqual({pending:{posts:['synthetic']}});
});
it('reuses its own window and replaces a closed one',async()=>{
  const h=harness(); await h.open(); await h.open(); expect(h.chrome.windows.create).toHaveBeenCalledTimes(1);
  h.windows.delete(2); await h.open(); expect(h.chrome.windows.create).toHaveBeenCalledTimes(2);
});
it('does not activate legacy readers or readers moved into the owner window',async()=>{
  const h=harness(); await h.open();
  await (h.context.wakeReaderTab as any)({tabId:11,windowId:1},400);
  await (h.context.withReaderForeground as any)({tabId:11,windowId:1},async()=>{});
  expect(h.owner.tabs[0].active).toBe(true);
});
it('does not change tabs when the owner opens or focuses the bot window',async()=>{
  const h=harness(); const reader=await h.open(); const win=h.windows.get(2); win.focused=true;
  h.updates.mockClear(); await (h.context.wakeReaderTab as any)(reader,400); expect(h.updates).not.toHaveBeenCalled();
  win.focused=false; win.tabs.push({id:99,windowId:2,url:'http://localhost:8001',active:true});
  h.updates.mockClear(); await (h.context.wakeReaderTab as any)(reader,400); expect(h.updates).not.toHaveBeenCalled();
});
it('checks the actual tab window rather than trusting saved reader metadata',async()=>{
  const h=harness(); const reader=await h.open(); const win=h.windows.get(2);
  const tab=win.tabs.find((t:any)=>t.id===reader.tabId); win.tabs=win.tabs.filter((t:any)=>t.id!==tab.id);
  tab.windowId=1; h.owner.tabs.push(tab); h.updates.mockClear();
  await (h.context.withReaderForeground as any)(reader,async()=>{});
  expect(h.updates).not.toHaveBeenCalled(); expect(h.owner.tabs[0].active).toBe(true);
});
it('leaves a minimized bot window minimized without focusing any window',async()=>{
  const h=harness(); const reader=await h.open(); h.windows.get(2).state='minimized'; h.updates.mockClear();
  await (h.context.wakeReaderTab as any)(reader,400);
  expect(h.updates).not.toHaveBeenCalled(); expect(h.chrome.windows.update).not.toHaveBeenCalled();
});
it('migrates the previous owner-window reference without touching personal Facebook',async()=>{
  const h=harness(); h.session.scrapeWindow={windowId:1,tabId:10,host:'owner'};
  const reader=await h.open(); expect(reader.windowId).toBe(2);
  expect(h.owner.tabs[1].url).toBe('https://www.facebook.com/'); expect(h.updates).not.toHaveBeenCalled();
});
it('does not restore an obsolete owner tab after the owner switches tabs during work',async()=>{
  const h=harness(); const reader=await h.open();
  await (h.context.withReaderForeground as any)(reader,async()=>{
    h.owner.tabs[0].active=false; h.owner.tabs[1].active=true;
  });
  expect(h.owner.tabs[1].active).toBe(true);
});

it('focuses only the owned reader window in explicitly enabled dedicated desktop mode',async()=>{
  const h=harness();h.local.dedicatedReaderDesktop=true;const reader=await h.open();
  await (h.context.withReaderForeground as any)(reader,async()=>{});
  expect(h.chrome.windows.update).toHaveBeenCalledWith(2,expect.objectContaining({focused:true}));
  expect(h.owner.tabs[0].active).toBe(true);
  h.chrome.windows.update.mockClear();
  await (h.context.wakeReaderTab as any)({tabId:11,windowId:1},400);
  expect(h.chrome.windows.update).not.toHaveBeenCalled();
});
it('dedicated mode still refuses a window containing personal tabs',async()=>{
  const h=harness();h.local.dedicatedReaderDesktop=true;const reader=await h.open();
  h.windows.get(2).tabs.push({id:99,windowId:2,url:'http://localhost:8001',active:true});
  await (h.context.wakeReaderTab as any)(reader,400);
  expect(h.chrome.windows.update).not.toHaveBeenCalled();
});

it('never steals the comment focus lease, including in dedicated desktop mode',async()=>{
  const h=harness();h.local.dedicatedReaderDesktop=true;const reader=await h.open();
  h.session.commentFocusLease={owner:'comment',until:Date.now()+60000};
  await (h.context.wakeReaderTab as any)(reader,400);
  expect(h.updates).not.toHaveBeenCalled();expect(h.chrome.windows.update).not.toHaveBeenCalled();
});
