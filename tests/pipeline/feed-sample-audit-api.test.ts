import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({authed:vi.fn(),source:vi.fn(),posts:vi.fn()}));
vi.mock("@/lib/guard",()=>({authed:mocks.authed}));
vi.mock("@/lib/prisma",()=>({prisma:{source:{findUnique:mocks.source},post:{findMany:mocks.posts}}}));
import { POST } from "@/app/api/automation-quality/feed-audit/route";
const payload={sourceId:"s1",items:[{url:"https://www.facebook.com/groups/42/posts/123"}]};
function request(body:unknown){return new Request("http://localhost/api/automation-quality/feed-audit",{method:"POST",body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();mocks.authed.mockResolvedValue({error:null});mocks.source.mockResolvedValue({id:"s1",type:"facebook_group",url:"https://www.facebook.com/groups/42"});mocks.posts.mockResolvedValue([]);});
describe("feed audit route",()=>{
 it("requires owner session before reading a body or DB",async()=>{mocks.authed.mockResolvedValue({error:new Response(null,{status:401})});expect((await POST(request(payload))).status).toBe(401);expect(mocks.source).not.toHaveBeenCalled();});
 it("rejects oversized streaming input without trusting content-length",async()=>{expect((await POST(request({...payload,padding:"ก".repeat(12000)}))).status).toBe(413);expect(mocks.source).not.toHaveBeenCalled();});
 it("rejects malformed JSON, missing source and >50 samples",async()=>{
  expect((await POST(new Request("http://localhost",{method:"POST",body:"{"}))).status).toBe(400);
  expect((await POST(request({items:payload.items}))).status).toBe(400);
  expect((await POST(request({...payload,items:Array(51).fill(payload.items[0])}))).status).toBe(400);
 });
 it("does bounded source-scoped candidate reads without selecting text or credentials",async()=>{
  const response=await POST(request(payload));expect(response.status).toBe(200);
  const query=mocks.posts.mock.calls[0][0];expect(query.where.sourceId).toBe("s1");expect(query.where.OR).toContainEqual({externalUrl:{contains:"/posts/123"}});expect(query.take).toBe(501);expect(query.select.text).toBeUndefined();expect(query.select.aiJobs.select).toEqual({status:true});
  const report=await response.json();expect(report.counts.missing).toBe(1);
 });
 it("rejects missing or unsupported sources without searching posts",async()=>{mocks.source.mockResolvedValue(null);expect((await POST(request(payload))).status).toBe(404);mocks.source.mockResolvedValue({id:"s1",type:"rss",url:"https://example.com"});expect((await POST(request(payload))).status).toBe(400);expect(mocks.posts).not.toHaveBeenCalled();});
 it("returns safe database errors",async()=>{mocks.posts.mockRejectedValue(new Error("postgres://secret"));const response=await POST(request(payload));expect(response.status).toBe(500);expect(await response.text()).not.toContain("secret");});
});
