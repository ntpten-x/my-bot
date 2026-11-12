// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
vi.mock('../../src/components/feed-sample-audit',()=>({FeedSampleAudit:()=>React.createElement('p',null,'sample audit')}));
vi.mock('../../src/components/comment-evidence',()=>({CommentEvidenceInspector:()=>React.createElement('p',null,'comment evidence')}));
import Page from '../../src/app/(app)/automation-quality/page';
it('shows advisory outcomes with explicit owner confirmation and never mutates or polls',async()=>{
 vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({checkedAt:'2026-11-12T12:00:00Z',days:7,expectedExtensionVersion:'synthetic',hasCurrentVersionHeartbeat:true,hasMore:false,scope:'sample scope',timingScope:'process only',timings:{ingest:{count:2,p50:12,p95:20}},sources:[{id:'s',name:'กลุ่มทดสอบ',type:'facebook_group',enabled:true,intervalMinutes:10,totalPosts:100,buyerPosts:20,contactedPosts:5,wonPosts:1,dismissedPosts:0,truncatedPosts:0,processingPending:0,runCount:10,errorRuns:0,advice:{action:'increase',reason:'ผลจากเจ้าของ',suggestedIntervalMinutes:5}}]}),{status:200}));
 vi.stubGlobal('fetch',fetcher);const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 try {
  await act(async()=>root.render(React.createElement(Page)));
  expect(container.textContent).toContain('เสนอทุก 5 นาที');expect(container.textContent).toContain('ตรวจและยืนยันเองที่แหล่งข้อมูล');
  await act(async()=>vi.advanceTimersByTimeAsync(120000));expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('/api/automation-quality/sources?days=7');
  expect(container.querySelector('a[href="/sources"]')).not.toBeNull();
 }finally{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals()}
});
