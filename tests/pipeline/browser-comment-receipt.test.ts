import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(()=>({transaction:vi.fn(),lock:vi.fn(),find:vi.fn(),update:vi.fn(),source:vi.fn(),log:vi.fn()}));
vi.mock('../../src/lib/prisma',()=>({prisma:{$transaction:mocks.transaction}}));
vi.mock('../../src/lib/auto-comment/control',()=>({lockCommentControl:mocks.lock,mayRun:vi.fn(),readCommentControl:vi.fn(),storeCommentControl:vi.fn()}));
import { reportBrowserComment } from '../../src/lib/auto-comment/browser';
const job={id:'j',ruleId:'r',postKey:'group:test:123',sourceId:'s',pageId:'',status:'sending'};
beforeEach(()=>{
 vi.resetAllMocks();mocks.find.mockResolvedValue(job);mocks.source.mockResolvedValue({url:'https://www.facebook.com/groups/test',type:'facebook_group',fbGroupId:'999'});
 mocks.lock.mockResolvedValue({state:'stopped'});
 mocks.transaction.mockImplementation(async fn=>fn({autoCommentJob:{findFirst:mocks.find,update:mocks.update},source:{findUnique:mocks.source},autoCommentLog:{create:mocks.log}}));
});
it('persists only verified numeric comment receipts while keeping browser-observed semantics',async()=>{
 expect(await reportBrowserComment('device','j','token','observed','https://web.facebook.com/groups/999/permalink/123/?comment_id=456&tracking=remove')).toBe(true);
 expect(mocks.update.mock.calls[0][0].data).toMatchObject({status:'browser_observed',remoteCommentId:'456',claimToken:null});
});
it('keeps ambiguous outcomes terminal without inventing a receipt or scheduling a resend',async()=>{
 for(const url of ['https://evil.example/groups/test/posts/123/?comment_id=456','https://www.facebook.com/groups/test/posts/124/?comment_id=456','https://name:secret@www.facebook.com/groups/test/posts/123/?comment_id=456','https://www.facebook.com/groups/test/posts/123/#comment_id=123bad','https://www.facebook.com/groups/test/posts/123/#comment_id=123_456','https://www.facebook.com/groups/test/posts/123/#not_comment_id=123']) {
  mocks.update.mockClear();await reportBrowserComment('device','j','token','observed',url);
  expect(mocks.update.mock.calls[0][0].data.status).toBe('uncertain');
  expect(mocks.update.mock.calls[0][0].data.remoteCommentId).toBeUndefined();
  expect(mocks.update.mock.calls[0][0].data.nextAttemptAt).toBeUndefined();
 }
});
it('does not replace a terminal receipt on an idempotent report replay',async()=>{
 mocks.find.mockResolvedValueOnce(null).mockResolvedValueOnce({...job,status:'browser_observed',remoteCommentId:'456'});
 expect(await reportBrowserComment('device','j','token','observed','https://www.facebook.com/groups/test/posts/123/?comment_id=789')).toBe(true);
 expect(mocks.update).not.toHaveBeenCalled();
});

it('accepts an exact numeric fragment receipt without keeping arbitrary tracking',async()=>{
 await reportBrowserComment('device','j','token','observed','https://www.facebook.com/groups/test/posts/123/#reply_comment_id=789&tracking=remove');
 expect(mocks.update.mock.calls[0][0].data).toMatchObject({status:'browser_observed',remoteCommentId:'789'});
});
