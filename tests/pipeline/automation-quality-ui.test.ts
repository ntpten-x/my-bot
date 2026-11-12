import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('../../src/components/feed-sample-audit',()=>({FeedSampleAudit:()=>React.createElement('div',null,'sample audit')}));
vi.mock('../../src/components/comment-evidence',()=>({CommentEvidenceInspector:()=>React.createElement('div',null,'comment evidence')}));
import Page from '../../src/app/(app)/automation-quality/page';
it('explains on-demand quality measurement without starting collection or sending',()=>{
 vi.stubGlobal('React',React);
 try {
  const html=renderToStaticMarkup(React.createElement(Page));
  expect(html).toContain('คุณภาพฟีดและคอมเมนต์');expect(html).toContain('ไม่เริ่มอ่านฟีดหรือส่งคอมเมนต์');
  expect(html).toContain('comment evidence');expect(html).not.toContain('เริ่มส่งจริง');
 }finally{vi.unstubAllGlobals()}
});
