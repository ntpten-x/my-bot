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
 const context=vm.createContext({Date,Map,fullTextBudget:10,loadFullTextBacklog:async()=>backlog,saveFullTextBacklog:async(b:Record<string,unknown>)=>{backlog=b},loadConfig:async()=>({token:"same"}),base:()=>"server",openReader:async(url:string)=>({tabId:url}),closeReader:async()=>{},sourceKind:()=>"group",readFullTexts:async(_tab:string,_kind:string,urls:string[])=>{read.push(urls[0]);return {found:[],failed:urls}},sendPosts:async()=>{throw Error("must not send")},cleanPost:(x:unknown)=>x});
 vm.runInContext(source.slice(source.indexOf("async function processFullTextQueue("),source.indexOf("let cycling = false;")),context);
 await vm.runInContext('processFullTextQueue({token:"same"},[{id:"g"},{id:"h"}])',context);
 expect(read).toEqual(["a","b","d"]);expect(Object.keys(backlog)).toHaveLength(4);
});
