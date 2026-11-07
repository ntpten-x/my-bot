import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
it("never relabels an unrelated article as the requested full-text post", async () => {
 const source=readFileSync("extension/background.js","utf8");
 const context=vm.createContext({Date,fullTextBudget:10,FULL_TEXT_BUDGET_MS:30000,chrome:{tabs:{update:async()=>{}},scripting:{executeScript:async()=>{}}},waitComplete:async()=>{},sleep:async()=>{},readPage:async()=>({posts:[{url:"other",text:"very long unrelated post",truncated:false}]}),postKey:(url:string)=>url});
 vm.runInContext(source.slice(source.indexOf("async function readFullTexts("),source.indexOf("// Wait (read-only)")),context);
 const result=await vm.runInContext('readFullTexts(1,"group",["target"])',context);
 expect(result.found).toHaveLength(0);expect(result.failed).toEqual(["target"]);
});
it("processes durable detail work fairly and retains failed targets", async () => {
 const source=readFileSync("extension/background.js","utf8");
 let backlog:Record<string,unknown>={a:{groupId:"g",addedAt:1},b:{groupId:"g",addedAt:2},c:{groupId:"g",addedAt:3},d:{groupId:"h",addedAt:4}};
 const read:string[]=[];
 const context=vm.createContext({chrome:{storage:{local:{get:async()=>({}),set:async()=>{}}}},Date,Map,fullTextBudget:10,loadFullTextBacklog:async()=>backlog,saveFullTextBacklog:async(b:Record<string,unknown>)=>{backlog=b},loadConfig:async()=>({token:"same"}),base:()=>"server",openReader:async(url:string)=>({tabId:url}),closeReader:async()=>{},sourceKind:()=>"group",readFullTexts:async(_tab:string,_kind:string,urls:string[])=>{read.push(urls[0]);return {found:[],failed:urls}},sendPosts:async()=>{throw Error("must not send")},cleanPost:(x:unknown)=>x});
 vm.runInContext(source.slice(source.indexOf("async function processFullTextQueue("),source.indexOf("let cycling = false;")),context);
 await vm.runInContext('processFullTextQueue({token:"same"},[{id:"g"},{id:"h"}])',context);
 expect(read).toEqual(["a","d","b"]);expect(Object.keys(backlog)).toHaveLength(4);
});
it("drains newly discovered detail work before discovering the next group", async () => {
 const source=readFileSync("extension/background.js","utf8"); const events:string[]=[];
 const context=vm.createContext({Date,Math,cycling:false,RUN_LOCK_MS:720000,
 chrome:{storage:{local:{get:async(d:object)=>({...d,outboxBlocked:false,fbIdentity:null,throttledAt:0}),set:async()=>{}}}},
 loadConfig:async()=>({token:"synthetic",paused:false,schedules:{}}),takeRunLock:async()=>true,releaseRunLock:async()=>{},
 getJson:async()=>({ok:true,json:async()=>({groups:[{id:"a"},{id:"b"}],maxGroupsPerCycle:2,jitterMinutes:0})}),
 quietReason:async()=>null,setQuiet:async()=>{},loadFullTextBacklog:async()=>({}),sleep:async()=>{},rememberError:async()=>{},
 scrapeGroup:async(_cfg:unknown,g:{id:string})=>{events.push(`feed:${g.id}`);return {}},
 processFullTextQueue:async(_cfg:unknown,_groups:unknown,options?:{maxItems:number})=>{events.push(options?.maxItems===1?"detail:slice":"detail:tail")}});
 vm.runInContext(source.slice(source.indexOf("async function cycle()"),source.indexOf("const recentManual")),context);
 await vm.runInContext("cycle()",context);
 expect(events).toEqual(["feed:a","detail:slice","feed:b","detail:slice","detail:tail"]);
});
it("waits for delayed exact-target content rather than failing after navigation", async () => {
 const source=readFileSync("extension/background.js","utf8"); let reads=0;
 const context=vm.createContext({Date,Math,fullTextBudget:10,FULL_TEXT_BUDGET_MS:30000,chrome:{tabs:{update:async()=>{}},scripting:{executeScript:async()=>{}}},waitComplete:async()=>{},sleep:async()=>{},readPage:async()=>({posts:++reads<3?[]:[{url:"target",text:"complete target",truncated:false}]}),postKey:(u:string)=>u});
 vm.runInContext(source.slice(source.indexOf("async function readFullTexts("),source.indexOf("// Wait (read-only)")),context);
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
