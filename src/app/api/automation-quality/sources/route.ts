import { authed } from '@/lib/guard';
import { json } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { EXPECTED_EXTENSION_VERSION } from '@/lib/extension-heartbeat';
import { requestMetrics } from '@/lib/metrics';
import { sourceValueAdvice } from '@/lib/source-value';
import { sourceRunEfficiency } from '@/lib/source-efficiency';
export const dynamic = 'force-dynamic';
function reportJson(data: unknown, status = 200) { const response = json(data, status); response.headers.set('Cache-Control','no-store'); return response; }

export async function GET(request: Request) {
  const { error } = await authed(); if (error) return error;
  const days = Number(new URL(request.url).searchParams.get('days') || 7);
  if (![7,30].includes(days)) return reportJson({error:'เลือกช่วง 7 หรือ 30 วัน'},400);
  try {
    const now = new Date(), since = new Date(now.getTime() - days * 86400000);
    const fetched = await prisma.source.findMany({where:{type:{in:['facebook_group','facebook_marketplace']}},select:{id:true,name:true,type:true,enabled:true,intervalMinutes:true,lastExtensionAt:true},orderBy:{id:'asc'},take:101});
    const sources = fetched.slice(0,100), ids = sources.map(row=>row.id);
    const [posts, truncated, pending, runs, heartbeat] = await Promise.all([
      prisma.post.groupBy({by:['sourceId','intent','pipelineStatus','dismissed'],where:{sourceId:{in:ids},createdAt:{gte:since},duplicateOfId:null},_count:{_all:true}}),
      prisma.post.groupBy({by:['sourceId'],where:{sourceId:{in:ids},createdAt:{gte:since},duplicateOfId:null,truncated:true},_count:{_all:true}}),
      prisma.post.groupBy({by:['sourceId'],where:{sourceId:{in:ids},processingState:{in:['pending_new','pending_edit']}},_count:{_all:true}}),
      prisma.scrapeRun.groupBy({
        by:['sourceId','ok','hitLimit'],
        where:{sourceId:{in:ids},createdAt:{gte:since},extVersion:EXPECTED_EXTENSION_VERSION},
        _count:{_all:true},
        _sum:{found:true,fresh:true,inserted:true,stalls:true,durationMs:true},
        _max:{createdAt:true},
      }),
      prisma.extensionHeartbeat.count({where:{version:EXPECTED_EXTENSION_VERSION,lastSeenAt:{gte:new Date(now.getTime()-600000)}}}),
    ]);
    const rows = sources.map(source=>{
      const own = posts.filter(row=>row.sourceId===source.id), ownRuns = runs.filter(row=>row.sourceId===source.id);
      const sum = (predicate: (row:typeof own[number])=>boolean) => own.filter(predicate).reduce((count,row)=>count+row._count._all,0);
      const runCount = ownRuns.reduce((n,row)=>n+row._count._all,0);
      const errorRuns = ownRuns.filter(row=>!row.ok).reduce((n,row)=>n+row._count._all,0);
      const hitLimitRuns = ownRuns.filter(row=>row.hitLimit).reduce((n,row)=>n+row._count._all,0);
      const runSum = (key:'found'|'fresh'|'inserted'|'stalls'|'durationMs') => ownRuns.reduce((n,row)=>n+(row._sum[key]??0),0);
      const counts = {
        totalPosts:sum(()=>true),buyerPosts:sum(row=>row.intent==='buyer'),unknownPosts:sum(row=>row.intent==='unknown'),contactedPosts:sum(row=>['contacted','replied'].includes(row.pipelineStatus)),wonPosts:sum(row=>row.pipelineStatus==='closed_won'),dismissedPosts:sum(row=>row.dismissed),truncatedPosts:truncated.find(row=>row.sourceId===source.id)?._count._all??0,processingPending:pending.find(row=>row.sourceId===source.id)?._count._all??0,
        runCount,errorRuns,hitLimitRuns,
        runFound:runSum('found'),runFresh:runSum('fresh'),runInserted:runSum('inserted'),runStalls:runSum('stalls'),runDurationMs:runSum('durationMs'),
      };
      const currentVersionRunAt = ownRuns.reduce<Date|null>((latest,row)=>row._max.createdAt && (!latest || row._max.createdAt>latest) ? row._max.createdAt : latest,null);
      const efficiency = sourceRunEfficiency({runs:runCount,errorRuns,hitLimitRuns,found:counts.runFound,fresh:counts.runFresh,inserted:counts.runInserted,stalls:counts.runStalls,durationMs:counts.runDurationMs});
      return {...source,...counts,currentVersionRunAt,efficiency,advice:sourceValueAdvice({...source,...counts,lastExtensionAt:currentVersionRunAt,hasCurrentVersionHeartbeat:heartbeat>0},now)};
    });
    return reportJson({checkedAt:now.toISOString(),since:since.toISOString(),days,expectedExtensionVersion:EXPECTED_EXTENSION_VERSION,hasCurrentVersionHeartbeat:heartbeat>0,hasMore:fetched.length>100,sources:rows,timings:requestMetrics(),timingScope:'สูงสุด 200 ตัวอย่างต่อตัวชี้วัดใน web process นี้ รีเซ็ตเมื่อเริ่มใหม่ ไม่ใช่สถิติทุกเครื่องหรือสถิติย้อนหลังทั้งช่วง',
      scope:'ผลจากสถานะปัจจุบันของโพสต์ที่นำเข้าในช่วงเวลา ไม่ใช่รายได้หรือความแม่นยำ ทั้งโพสต์และผลเจ้าของอาจมาจากหลายรุ่น รอบอ่านกรองตามรุ่นปัจจุบัน ข้อเสนอไม่เปลี่ยนการตั้งค่าเอง'});
  } catch {return reportJson({error:'อ่านข้อมูลคุณภาพแหล่งข้อมูลไม่สำเร็จ'},503);}
}
