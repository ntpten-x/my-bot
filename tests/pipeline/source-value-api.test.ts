import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(()=>({auth:vi.fn(),sources:vi.fn(),posts:vi.fn(),runs:vi.fn(),heartbeat:vi.fn()}));
vi.mock('../../src/lib/guard',()=>({authed:mocks.auth}));
vi.mock('../../src/lib/prisma',()=>({prisma:{source:{findMany:mocks.sources},post:{groupBy:mocks.posts},scrapeRun:{groupBy:mocks.runs},extensionHeartbeat:{count:mocks.heartbeat}}}));
import { GET } from '../../src/app/api/automation-quality/sources/route';
import { EXPECTED_EXTENSION_VERSION } from '../../src/lib/extension-heartbeat';
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({error:null});mocks.sources.mockResolvedValue([{id:'s',name:'test',type:'facebook_group',enabled:true,intervalMinutes:10,lastExtensionAt:new Date()}]);mocks.posts.mockResolvedValue([]);mocks.runs.mockResolvedValue([]);mocks.heartbeat.mockResolvedValue(0)});
it('authenticates before reading and rejects unbounded report windows',async()=>{
 mocks.auth.mockResolvedValueOnce({error:new Response(null,{status:401})});expect((await GET(new Request('http://localhost/api?days=7'))).status).toBe(401);expect(mocks.sources).not.toHaveBeenCalled();
 expect((await GET(new Request('http://localhost/api?days=365'))).status).toBe(400);expect(mocks.sources).not.toHaveBeenCalled();
});
it('bounds sources, scopes runs to current version and does not infer collection from a global heartbeat',async()=>{
 mocks.heartbeat.mockResolvedValue(1);
 const response=await GET(new Request('http://localhost/api?days=7')), body=await response.json();
 expect(response.status).toBe(200);expect(mocks.sources.mock.calls[0][0].take).toBe(101);
 expect(mocks.runs.mock.calls[0][0].where.extVersion).toBe(EXPECTED_EXTENSION_VERSION);
 expect(body.sources[0].advice).toMatchObject({action:'unknown',suggestedIntervalMinutes:null});
 expect(body.sources[0].currentVersionRunAt).toBeNull();expect(response.headers.get('cache-control')).toBe('no-store');
});
it('redacts database errors',async()=>{
 mocks.sources.mockRejectedValue(new Error('synthetic-database-secret'));
 const response=await GET(new Request('http://localhost/api'));
 expect(response.status).toBe(503);expect(await response.text()).not.toContain('synthetic-database-secret');
});
