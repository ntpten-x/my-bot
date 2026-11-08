import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
const source=readFileSync('extension/background.js','utf8');
afterEach(()=>vi.useRealTimers());
function harness(count=0,keys:string[]=[]) {
 const frozenTimer=vi.fn(()=>1);
 const root={scrollHeight:1000};
 const doc={scrollingElement:root,documentElement:root,body:{},querySelectorAll:(selector:string)=>selector.includes('role="article"')||selector.includes('aria-posinset')?Array.from({length:count},()=>({})):keys.map(href=>({href}))};
 const page=vm.createContext({document:doc,Set,globalThis:undefined,MutationObserver:class{observe(){}disconnect(){}},setTimeout:frozenTimer,clearTimeout:()=>{}});
 vm.runInContext('globalThis=this;globalThis.MyBotScrape={feedRoot:()=>document,scrollRoot:()=>document.scrollingElement,postKey:url=>url}',page);
 const chrome={scripting:{executeScript:async({func,args}:any)=>{const f=vm.runInContext(`(${func.toString()})`,page);return [{result:await f(...args)}];}}};
 const host=vm.createContext({chrome,Promise,Date,Set,setTimeout,clearTimeout,sleep:(ms:number)=>new Promise(r=>setTimeout(r,ms))});
 vm.runInContext(source.slice(source.indexOf('async function executeReaderScript('),source.indexOf('async function readPage(')),host);
 vm.runInContext(source.slice(source.indexOf('async function waitForGrowth('),source.indexOf('/** Activate only')),host);
 return {frozenTimer,wait:(before:number,timeout:number,known:string[]=[])=> (host.waitForGrowth as any)(1,'group',before,timeout,known)};
}
it('finishes a bounded no-growth wait even when page-owned timers never run',async()=>{
 vi.useFakeTimers();const h=harness();
 const result=h.wait(0,1000).catch((e:Error)=>({error:e.message}));
 await vi.advanceTimersByTimeAsync(2000);
 expect(await result).toEqual({count:0,grew:false,height:1000});
 expect(h.frozenTimer).not.toHaveBeenCalled();
});
it('recognizes virtualized new keys without needing a page timer or DOM count increase',async()=>{
 vi.useFakeTimers();const h=harness(3,['new']);const result=h.wait(3,1000,['old']).catch((e:Error)=>({error:e.message}));
 await vi.advanceTimersByTimeAsync(2000);
 expect(await result).toEqual({count:3,grew:true,height:1000});
 expect(h.frozenTimer).not.toHaveBeenCalled();
});
