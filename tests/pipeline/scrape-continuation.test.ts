import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sources:vi.fn(), posts:vi.fn(), updatePosts:vi.fn(), update:vi.fn(), run:vi.fn(), log:vi.fn(), find:vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: {
  source:{findMany:mocks.sources,update:mocks.update}, post:{findMany:mocks.posts,updateMany:mocks.updatePosts},
  scrapeRun:{create:mocks.run}, fetchLog:{create:mocks.log},
} }));
vi.mock("../../src/lib/settings", () => ({ getSettings:async () => ({maxPostAgeHours:24,maxGroupsPerCycle:20,jitterMinutes:2}) }));
vi.mock("../../src/lib/sources", () => ({findSourceByUrl:mocks.find}));
import { buildExtensionConfig, recordScrapeRun, summarizeReaderRuns } from "../../src/lib/scrape-runs";

const now = new Date("2026-11-07T12:00:00Z");
const source = {id:"s",url:"https://www.facebook.com/groups/12345",type:"facebook_group",priority:"normal",intervalMinutes:10,currentIntervalMinutes:10};
beforeEach(() => { vi.clearAllMocks(); mocks.find.mockResolvedValue(source); mocks.posts.mockResolvedValue([]); });

it.each(["cap","limit","screens","yield"])("schedules %s continuation in 30 seconds without jitter", async stoppedBy => {
  const result = await recordScrapeRun({sourceUrl:source.url,ok:true,postsFound:200,newPosts:0,scrolls:20,stoppedBy,coverage:{newCount:200}},now,()=>1);
  expect(result!.nextRunAt.getTime()-now.getTime()).toBe(30_000);
  expect(mocks.update.mock.calls[0][0].data.nextRunAt).toEqual(result!.nextRunAt);
  expect(mocks.log.mock.calls[0][0].data.message).toContain("30 วินาที");
});

it("spaces loading recovery at one minute instead of a productive 30-second continuation", async () => {
  const result = await recordScrapeRun({sourceUrl:source.url,ok:true,postsFound:3,newPosts:0,scrolls:20,stoppedBy:"loading",coverage:{hitLimit:true}},now,()=>0);
  expect(result!.nextRunAt.getTime()-now.getTime()).toBe(60_000);
});

it("keeps hints for sources beyond the first cycle and bounds concurrent hint queries", async () => {
  mocks.sources.mockResolvedValue(Array.from({length:25},(_,i)=>({...source,id:String(i),name:String(i),nextRunAt:null,lastRunFound:200,lastRunStop:i===0?"cap":"exhausted"})));
  let inFlight=0,maxInFlight=0;
  mocks.posts.mockImplementation(async (query:any) => {
    if (typeof query.where.sourceId !== "string") return [];
    inFlight++; maxInFlight=Math.max(maxInFlight,inFlight);
    await Promise.resolve();
    inFlight--;
    expect(query.take).toBe(300);
    return [{sourceId:query.where.sourceId,externalUrl:`https://www.facebook.com/groups/12345/posts/${1000+Number(query.where.sourceId)}`,postedAt:now,createdAt:now,text:"synthetic"}];
  });
  const config = await buildExtensionConfig(now);
  expect(config.groups[24].knownKeys).toHaveLength(1);
  expect(config.groups.find(g=>g.id==="0")!.needsCoverage).toBe(true);
  expect(config.groups.find(g=>g.id==="24")!.needsCoverage).toBe(false);
  expect(maxInFlight).toBeLessThanOrEqual(4);
});

it("reports capture rate and incomplete slices from persisted runs", () => {
  const base={windowState:"normal",stalls:0,reloaded:false,throttled:false,fullTried:0,fullOk:0,durationMs:30_000,found:5,ok:true};
  expect(summarizeReaderRuns([{...base,fresh:12,inserted:10,stoppedBy:"limit",hitLimit:true},{...base,fresh:8,inserted:8,stoppedBy:"exhausted"}])).toMatchObject({fresh:20,inserted:18,freshPerMinute:20,incomplete:1,errors:0});
});

it("does not spend full-text retry attempts just by polling configuration", async () => {
  mocks.sources.mockResolvedValue([{...source,nextRunAt:null,lastRunStop:"exhausted",lastRunFound:5}]);
  const externalUrl=`${source.url}/posts/1000`;
  mocks.posts.mockImplementation(async (query:any) => query.where.truncated ? [{id:"p",sourceId:"s",externalUrl,score:1,createdAt:now,refetchAttempts:0}] : []);
  for(let i=0;i<2;i++) expect((await buildExtensionConfig(now)).groups[0].refetchUrls).toEqual([externalUrl]);
  expect(mocks.updatePosts).not.toHaveBeenCalled();
});
