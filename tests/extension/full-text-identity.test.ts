/* eslint-disable @typescript-eslint/no-explicit-any -- VM fixtures model untyped Chrome storage and extension worker globals. */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
it("never relabels an unrelated article as the requested full-text post", async () => {
 const source=readFileSync("extension/background.js","utf8");
 const context=vm.createContext({Date,setTimeout,clearTimeout,fullTextBudget:10,FULL_TEXT_BUDGET_MS:30000,chrome:{tabs:{update:async()=>{}},scripting:{executeScript:async()=>{}}},waitComplete:async()=>{},sleep:async()=>{},injectReaders:async()=>{},readPage:async()=>({posts:[{url:"other",text:"very long unrelated post",truncated:false}]}),postKey:(url:string)=>url});
 vm.runInContext(source.slice(source.indexOf("async function readFullTexts("),source.indexOf("async function waitForGrowth(")),context);
 const result=await vm.runInContext('readFullTexts(1,"group",["target"])',context);
 expect(result.found).toHaveLength(0);expect(result.failed).toEqual(["target"]);
});
it("processes durable detail work fairly and retains failed targets", async () => {
 const source=readFileSync("extension/background.js","utf8");
 let backlog:Record<string,any>={a:{groupId:"g",addedAt:1},b:{groupId:"g",addedAt:2},c:{groupId:"g",addedAt:3},d:{groupId:"h",addedAt:4}};
 const read:string[]=[];
 const context=vm.createContext({chrome:{storage:{local:{get:async()=>({}),set:async()=>{}}}},Date,Map,activeReaderTabs:new Set(),fullTextBudget:10,loadFullTextBacklog:async()=>backlog,saveFullTextBacklog:async(b:Record<string,unknown>)=>{backlog=b},updateFullTextBacklog:async(mutator:(b:Record<string,any>)=>Promise<void>|void)=>{await mutator(backlog);},loadConfig:async()=>({token:"same"}),base:()=>"server",openReader:async(url:string)=>({tabId:url}),closeReader:async()=>{},sourceKind:()=>"group",readFullTexts:async(_tab:string,_kind:string,urls:string[])=>{read.push(urls[0]);return {found:[],failed:urls}},sendPosts:async()=>{throw Error("must not send")},cleanPost:(x:unknown)=>x});
 vm.runInContext(source.slice(source.indexOf("async function processFullTextQueue("),source.indexOf("let cycling = false;")),context);
 await vm.runInContext('processFullTextQueue({token:"same"},[{id:"g"},{id:"h"}])',context);
 expect(read).toEqual(["a","d","b"]);expect(Object.keys(backlog)).toHaveLength(4);
});
it("discovers every due group with bounded parallelism then drains detail work once", async () => {
 const source=readFileSync("extension/background.js","utf8"); const events:string[]=[];
 async function mapPool(items: {id:string}[], _concurrency:number, worker:(g:{id:string},i:number)=>Promise<unknown>) {
   return Promise.all(items.map((item, index) => worker(item, index)));
 }
 const context=vm.createContext({Date,setTimeout,clearTimeout,Math,cycling:false,runLockBusy:async()=>false,applyServerRoute:async()=>{},RUN_LOCK_MS:720000,Promise,PARALLEL_SCRAPE:3,mapPool,
 chrome:{storage:{local:{get:async(d:object)=>({...d,outboxBlocked:false,fbIdentity:null,throttledAt:0}),set:async()=>{}}}},
 loadConfig:async()=>({token:"synthetic",paused:false,schedules:{}}),takeRunLock:async()=>true,releaseRunLock:async()=>{},closeOrphanReaders:async()=>{},
 probeFacebookIdentity:async()=>null,
 currentFbUserId:async()=>"",base:()=>"server",pruneContinuations:async()=>{},recoveryKey:()=>"synthetic",
 getJson:async()=>({ok:true,json:async()=>({groups:[{id:"a"},{id:"b"}],maxGroupsPerCycle:20,jitterMinutes:0})}),
 quietReason:async()=>"",setQuiet:async()=>{},loadFullTextBacklog:async()=>({}),sleep:async()=>{},rememberError:async()=>{},
 setReadingStatus:async()=>{},heartbeat:async()=>{},
 scrapeGroup:async(_cfg:unknown,g:{id:string})=>{events.push(`feed:${g.id}`);return {}},
 processFullTextQueue:async()=>{events.push("detail:tail")},
 scheduleDueWake:async()=>{},
 globalThis:{},
 MyBotScrape:{
   prioritizeCoverageDue:(groups:{id:string}[])=>groups,
   orderDueGroups:(groups:{id:string}[])=>groups,
   throttleLevel:()=>"none",
   cycleBatchLimit:(opts:{limit?:number})=>opts.limit||20,
   cycleParallel:()=>2,
 }});
 context.globalThis=context;
 vm.runInContext(source.slice(source.indexOf("async function cycle()"),source.indexOf("const DUE_ALARM")),context);
 await vm.runInContext("cycle()",context);
 expect(events.filter((e)=>e.startsWith("feed:")).sort()).toEqual(["feed:a","feed:b"]);
 expect(events.filter((e)=>e==="detail:tail")).toHaveLength(1);
 expect(events.indexOf("detail:tail")).toBeGreaterThan(events.indexOf("feed:a"));
 expect(events.indexOf("detail:tail")).toBeGreaterThan(events.indexOf("feed:b"));
});
it("waits for delayed exact-target content rather than failing after navigation", async () => {
 const source=readFileSync("extension/background.js","utf8"); let reads=0;
 const context=vm.createContext({Date,setTimeout,clearTimeout,Math,fullTextBudget:10,FULL_TEXT_BUDGET_MS:30000,chrome:{tabs:{update:async()=>{}},scripting:{executeScript:async()=>{}}},waitComplete:async()=>{},sleep:async()=>{},injectReaders:async()=>{},readPage:async()=>({posts:++reads<3?[]:[{url:"target",text:"complete target",truncated:false}]}),postKey:(u:string)=>u});
 vm.runInContext(source.slice(source.indexOf("async function readFullTexts("),source.indexOf("async function waitForGrowth(")),context);
 const result=await vm.runInContext('readFullTexts(1,"group",["target"])',context);
 expect(reads).toBe(3);expect(result.found).toHaveLength(1);expect(result.failed).toHaveLength(0);
});
it("matches equivalent Facebook permalinks while rejecting ambiguous or foreign targets", () => {
 const source=readFileSync("extension/background.js","utf8"); const context=vm.createContext({URL});
 vm.runInContext(source.slice(source.indexOf("function postKey(url)"),source.indexOf("// Posts cut off")),context);
 const key=(url:string)=>vm.runInContext(`postKey(${JSON.stringify(url)})`,context);
 const target="https://www.facebook.com/groups/123/posts/456/";
 expect(key(target)).toBe("group:123:456");
 expect(key("https://web.facebook.com/groups/123/?multi_permalinks=456&ref=test")).toBe(key(target));
 expect(key("https://m.facebook.com/groups/123/permalink/456")).toBe(key(target));
 expect(key("https://www.facebook.com/groups/999/?multi_permalinks=456")).not.toBe(key(target));
 for(const url of ["https://evil.test/groups/123/posts/456", "https://www.facebook.com/groups/123/?multi_permalinks=456,789", "https://www.facebook.com/groups/123/posts/456?multi_permalinks=789", "https://www.facebook.com/groups/123/posts/456?comment_id=1", "https://www.facebook.com/groups/123/?multi_permalinks=456&multi_permalinks=789"]) expect(key(url)).toBe("");
});
it.each([3, 4])("gives %i due groups and tail detail work one shared cycle budget",async(count)=>{
 const source=readFileSync("extension/background.js","utf8");const started=Date.now();let now=started;
 const calls:{id:string;deadlineMs:number}[]=[];
 const details:{deadlineMs:number;budgetMs:number}[]=[];
 class Clock extends Date{static now(){return now;}}
 const context=vm.createContext({Date:Clock,Math,cycling:false,runLockBusy:async()=>false,applyServerRoute:async()=>{},PARALLEL_SCRAPE:2,
 chrome:{storage:{local:{get:async(d:object)=>({...d}),set:async()=>{}}}},
 loadConfig:async()=>({token:"synthetic",paused:false,schedules:{}}),takeRunLock:async()=>true,releaseRunLock:async()=>{},closeOrphanReaders:async()=>{},
 probeFacebookIdentity:async()=>null,currentFbUserId:async()=>"",base:()=>"server",pruneContinuations:async()=>{},recoveryKey:()=>"key",
 getJson:async()=>({ok:true,json:async()=>({groups:["a","b","c","d"].slice(0,count).map(id=>({id})),maxGroupsPerCycle:20})}),
 quietReason:async()=>"",setQuiet:async()=>{},loadFullTextBacklog:async()=>({}),sleep:async(ms:number)=>{now+=ms;},rememberError:async()=>{},
 setReadingStatus:async()=>{},heartbeat:async()=>{},
 mapPool:async(items:any[],_parallel:number,worker:any)=>{const out=[];for(let i=0;i<items.length;i++)out.push(await worker(items[i],i));return out;},
 scrapeGroup:async(_cfg:unknown,g:{id:string},_remote:unknown,options:{deadlineMs:number})=>{calls.push({id:g.id,deadlineMs:options.deadlineMs});expect(options.deadlineMs-now).toBeLessThanOrEqual(45_000);now=options.deadlineMs;return {ok:true,nextRunAt:now+30_000};},
 processFullTextQueue:async(_cfg:unknown,_groups:unknown,options:{deadlineMs:number;budgetMs:number})=>{details.push(options);now+=Math.min(options.budgetMs,options.deadlineMs-now);},scheduleDueWake:async()=>{},
 MyBotScrape:{orderDueGroups:(g:any[])=>g,throttleLevel:()=>"none",cycleBatchLimit:()=>20,cycleParallel:()=>1},
 });
 vm.runInContext(source.slice(source.indexOf("async function cycle()"),source.indexOf("const DUE_ALARM")),context);
 await vm.runInContext("cycle()",context);
 expect(calls.map(g=>g.id)).toEqual(["a","b","c","d"].slice(0,count));
 if(count===3) expect(details[0].deadlineMs).toBe(started+180_000);
 expect(now-started).toBeLessThanOrEqual(180_000);
});
it("bounds an unresponsive executeScript without discarding reader state",async()=>{
 const source=readFileSync("extension/background.js","utf8");const context=vm.createContext({setTimeout,clearTimeout,chrome:{scripting:{executeScript:()=>new Promise(()=>{})}}});
 vm.runInContext(source.slice(source.indexOf("async function executeReaderScript("),source.indexOf("async function readPage(")),context);
 await expect(vm.runInContext("executeReaderScript({},10)",context)).rejects.toThrow("แท็บอ่านไม่ตอบ");
});
