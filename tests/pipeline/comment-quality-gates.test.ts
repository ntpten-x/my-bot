import { expect, it } from 'vitest';
import { commentIntent } from '../../src/lib/auto-comment/intent';
import { explainCommentRule, type MatchRule } from '../../src/lib/auto-comment/matching';
const now=new Date('2026-11-12T12:00:00Z');
const rule:MatchRule={enabled:true,pausedReason:'',sourceIdsJson:'["s"]',keywords:'รองเท้า',excludeKeywords:'',keywordMode:'any',intentMode:'buyer',startMinute:0,endMinute:1440,daysJson:'[0,1,2,3,4,5,6]',maxAgeHours:24};
const post=(text:string)=>({text,sourceId:'s',createdAt:now,postedAt:null,isAd:false,forbiddenHit:false,duplicateOfId:null,dismissed:false});
it.each(['หาซื้อรองเท้า อัปเดต: เลิกตามหาแล้ว','หาซื้อรองเท้า ยกเลิกการหาแล้ว','ตามหารองเท้า ปิดการตามหาแล้ว'])('blocks withdrawn requests even when a historical owner label says buyer: %s',text=>{
 expect(commentIntent({text,intent:'buyer',aiProvider:'owner'}).closed).toBe(true);
 expect(explainCommentRule(rule,post(text),now).matched).toBe(false);
});
it.each(['หาซื้อรองเท้า ยังไม่ยกเลิกการหา','ตามหารองเท้า ไม่เลิกตามหาจนกว่าจะได้','ตามหารองเท้า ไม่ซื้อของปลอม','หาซื้อรองเท้า ไม่ยกเลิกตามหา','หาซื้อรองเท้า ยังไม่เลิกหา'])('preserves active buying and attribute exclusions: %s',text=>{
 expect(commentIntent({text}).closed).toBe(false);
 expect(explainCommentRule(rule,post(text),now).matched).toBe(true);
});
it('retains full-text, stale-post and processing gates despite an owner buyer label',()=>{
 const buyer={...post('หาซื้อรองเท้า'),intent:'buyer',aiProvider:'owner'};
 for(const change of [{truncated:true},{postedAt:new Date(now.getTime()-25*3600000)},{processingState:'pending_edit'},{isAd:true}]) expect(explainCommentRule(rule,{...buyer,...change},now).matched).toBe(false);
});
