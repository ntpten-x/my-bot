import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({update:vi.fn(),jobs:vi.fn(),classify:vi.fn(),log:vi.fn()}));
vi.mock("../../src/lib/prisma",()=>({prisma:{
  aiJob:{updateMany:mocks.update,findMany:mocks.jobs},
  post:{findMany:async()=>[]},$queryRaw:async()=>[{id:"job"}],
}}));
vi.mock("../../src/lib/settings",()=>({getSettings:async()=>({aiProvider:"auto",ocrEnabled:false})}));
vi.mock("../../src/lib/sources",()=>({loadCatalogFromDb:async()=>({rows:[],catalog:[]}),resolveCategoryIds:()=>({})}));
vi.mock("../../src/lib/ai/run",()=>({classifyLeads:mocks.classify}));
vi.mock("../../src/lib/log",()=>({workerLog:mocks.log}));
vi.mock("../../src/lib/smart/enrich",()=>({enrichPosts:async()=>{}}));
vi.mock("../../src/lib/smart/duplicate-labels",()=>({syncDuplicateLabels:async()=>{}}));
vi.mock("../../src/lib/automation",()=>({applyAutomationRules:async()=>{}}));
vi.mock("../../src/lib/products",()=>({loadProducts:async()=>[],assignProducts:async()=>{}}));
vi.mock("../../src/lib/group-profiles",()=>({loadGroupHints:async()=>new Map()}));
vi.mock("../../src/lib/pipeline/ad-filter",()=>({scoreAd:()=>({score:0})}));
import {processAiQueue} from "../../src/lib/ai/queue";
import {classifyWithChain} from "../../src/lib/pipeline/classify";
import {MinuteWindow, providerRetryAt, dayKey, AiCallError, AiUnavailableError, guardedCall, classifyFailure, type RouterProvider} from "../../src/lib/ai/router";
const NOW=Date.parse("2026-11-07T16:30:00Z");
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);vi.stubEnv("MYBOT_PROCESS","worker");vi.clearAllMocks();
  mocks.update.mockResolvedValue({count:1});mocks.jobs.mockResolvedValue([{id:"job",postId:"p",attempts:9,createdAt:new Date(NOW-3600_000),post:{sourceId:"s",text:"ตามหาช่าง",textRevision:1,ocrText:"",contentHash:"synthetic",source:{type:"facebook_group"}}}]);
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("must not contact a provider");}));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("does not touch historical jobs or providers after removal",async()=>{for(let i=0;i<2;i++)expect(await processAiQueue()).toBe(0);expect(mocks.jobs).not.toHaveBeenCalled();expect(mocks.update).not.toHaveBeenCalled();expect(mocks.classify).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});

it("waits for every restriction on a provider and computes the exact minute release",async()=>{
  const now=new Date(NOW),minute=new MinuteWindow();
  const p:RouterProvider={id:"p",name:"p",enabled:true,priority:1,tasks:["classify"],cooldownUntil:new Date(NOW+30_000),usageDay:dayKey(now),requestsToday:10,limitPerDay:10,limitPerMinute:1,resetHourUtc:0};
  minute.add("p",now);
  expect(providerRetryAt(p,now,minute)).toBe(Date.parse("2026-11-08T00:00:00Z"));
  p.limitPerDay=null;
  expect(providerRetryAt(p,now,minute)).toBe(NOW+60_000);
  const call=vi.fn();
  await expect(guardedCall(p,"classify",{store:{recordSuccess:vi.fn(),recordFailure:vi.fn()},now:()=>now,minute},call)).rejects.toBeInstanceOf(AiUnavailableError);
  expect(call).not.toHaveBeenCalled();
});
it("does not spend the job failure budget on a real HTTP quota response",async()=>{
  const p:RouterProvider={id:"q",name:"q",enabled:true,priority:1,tasks:["classify"],limitPerMinute:null,limitPerDay:null,cooldownUntil:null,usageDay:null,requestsToday:0,resetHourUtc:0};
  const store={recordSuccess:vi.fn(async()=>{}),recordFailure:vi.fn(async()=>{})};
  const outcome=await classifyWithChain({posts:[{id:"p",text:"ตามหาช่าง"}],catalog:[],providers:[{name:"q",classify:()=>guardedCall(p,"classify",{store,now:()=>new Date(NOW)},async()=>{throw new AiCallError("daily quota",429,0,"quota");})}]});
  expect(outcome.attemptedIds).toEqual([]);
  expect(outcome.errors[0]).toMatchObject({deferred:true,retryAt:Date.parse("2026-11-08T00:00:00Z")});
  expect(store.recordFailure).toHaveBeenCalledOnce();
});
it("honors a provider Retry-After even when its response also mentions quota",()=>{
  expect(classifyFailure(new AiCallError("quota",429,120_000,"quota"),new Date(NOW))).toMatchObject({kind:"rate",cooldownMs:120_000});
});
