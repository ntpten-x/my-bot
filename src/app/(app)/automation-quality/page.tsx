"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/components/api';
import { Button, Card, Select } from '@/components/ui';
import { FeedSampleAudit } from '@/components/feed-sample-audit';
import { CommentEvidenceInspector } from '@/components/comment-evidence';
import type { SourceValueAdvice } from '@/lib/source-value';

type Source = {id:string;name:string;type:string;enabled:boolean;intervalMinutes:number;totalPosts:number;buyerPosts:number;contactedPosts:number;wonPosts:number;dismissedPosts:number;truncatedPosts:number;processingPending:number;runCount:number;errorRuns:number;currentVersionRunAt:string|null;advice:SourceValueAdvice};
type Report = {checkedAt:string;since:string;days:number;expectedExtensionVersion:string;hasCurrentVersionHeartbeat:boolean;hasMore:boolean;sources:Source[];scope:string;timingScope:string;timings:Record<string,{count:number;p50:number|null;p95:number|null}>};
const actionNames = {increase:'เสนออ่านถี่ขึ้น',decrease:'เสนออ่านห่างขึ้น',keep:'รักษาค่าปัจจุบัน',repair:'ตรวจปัญหาก่อนปรับ',unknown:'ข้อมูลยังไม่พอ'};
const timingNames:Record<string,string>={ingest:'รับข้อมูลรวม',ingest_prepare:'เตรียมข้อมูล',ingest_store:'บันทึกข้อมูล',ingest_enrich:'ประมวลผลหลังรับ',ingest_notify:'แจ้งเตือน',search:'ค้นหา',comment_scan:'ประเมินกฎคอมเมนต์',comment_prepare:'เตรียมงานคอมเมนต์',comment_scan_transaction:'ธุรกรรมประเมิน',comment_scan_lock:'รอ lock',comment_scan_rules:'อ่านกฎ',capture_to_ingest:'พบโพสต์ถึงรับข้อมูล (อาศัยนาฬิกา browser)'};
export default function AutomationQualityPage() {
  const [data,setData]=useState<Report|null>(null),[days,setDays]=useState(7),[epoch,setEpoch]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    api<Report>(`/api/automation-quality/sources?days=${days}`,{signal:controller.signal})
      .then(report=>{if(!controller.signal.aborted)setData(report)})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'โหลดรายงานไม่สำเร็จ')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return ()=>controller.abort();
  },[days,epoch]);
  function download() {
    if(!data)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`mybot-quality-${data.checkedAt.replace(/[:.]/g,'-')}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-7">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">คุณภาพฟีดและคอมเมนต์</h1><p className="mt-2 text-sm text-muted">ตรวจตามสั่ง ไม่เริ่มอ่านฟีดหรือส่งคอมเมนต์ และไม่เปลี่ยนตารางอ่านเอง</p></div><Link className="text-sm underline" href="/auto-comment">กลับหน้าคอมเมนต์</Link></div>
    <div className="flex flex-wrap items-center gap-3"><Select aria-label="ช่วงรายงาน" className="w-40" value={days} onChange={event=>setDays(Number(event.target.value))}><option value={7}>7 วัน</option><option value={30}>30 วัน</option></Select><Button disabled={loading} variant="outline" onClick={()=>setEpoch(value=>value+1)}>{loading?'กำลังอ่านข้อมูล…':'อัปเดตรายงาน'}</Button><Button variant="outline" disabled={!data||loading||Boolean(error)} onClick={download}>ดาวน์โหลดสรุป JSON</Button></div>
    {error?<p role="alert" className="text-sm text-red-700">{error}{data?' · ตารางด้านล่างเป็นข้อมูลเดิม':''}</p>:null}
    {data?<>
      <p className="text-xs text-muted">ตรวจเมื่อ {new Date(data.checkedAt).toLocaleString('th-TH')} · โพสต์ที่นำเข้าในช่วง {data.days} วัน · Extension ที่คาดหวัง {data.expectedExtensionVersion}{loading?' · กำลังโหลดรอบใหม่':''}</p>
      {!data.hasCurrentVersionHeartbeat?<p className="rounded-lg border border-amber-300 p-3 text-sm">ยังไม่พบ heartbeat สดของรุ่นปัจจุบัน จึงยังยืนยันการอ่านและเสนอเปลี่ยนความถี่ไม่ได้</p>:null}
      {data.hasMore?<p className="text-sm text-amber-800">รายงานจำกัด 100 แหล่งแรก ยังมีแหล่งอื่นที่ไม่ได้รวม</p>:null}
      <Card><h2 className="font-semibold">คุณค่าและความพร้อมของแหล่งข้อมูล</h2><p className="mt-2 text-xs text-muted">{data.scope}</p><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">แหล่งข้อมูล</th><th className="p-2">โพสต์ / buyer</th><th className="p-2">ตอบหรือติดต่อ / ชนะ</th><th className="p-2">ข้อความไม่ครบ / คิวค้าง</th><th className="p-2">ข้อเสนอ</th></tr></thead><tbody>{data.sources.map(source=><tr className="border-t border-line align-top" key={source.id}><td className="p-2 font-medium">{source.name}<p className="text-xs font-normal text-muted">ทุก {source.intervalMinutes} นาที · รอบรุ่นนี้ {source.runCount} / error {source.errorRuns}</p></td><td className="p-2">{source.totalPosts} / {source.buyerPosts}</td><td className="p-2">{source.contactedPosts} / {source.wonPosts}</td><td className="p-2">{source.truncatedPosts} / {source.processingPending}</td><td className="max-w-sm p-2"><strong>{actionNames[source.advice.action]}</strong><p className="mt-1 text-xs">{source.advice.reason}</p>{source.advice.suggestedIntervalMinutes!==null?<p className="mt-1 text-xs">เสนอทุก {source.advice.suggestedIntervalMinutes} นาที · <Link className="underline" href="/sources">ตรวจและยืนยันเองที่แหล่งข้อมูล</Link></p>:null}</td></tr>)}</tbody></table></div>{!data.sources.length?<p className="mt-3 text-sm text-muted">ยังไม่มีแหล่งกลุ่ม Facebook หรือ Marketplace</p>:null}</Card>
      <Card><h2 className="font-semibold">จุดรอและเวลาประมวลผล</h2><p className="mt-2 text-xs text-muted">{data.timingScope} · แต่ละแถววัดคนละช่วง ห้ามนำ p95 มาบวกกันเป็นเวลารวม</p><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">ช่วง</th><th className="p-2">ตัวอย่าง</th><th className="p-2">p50 (ms)</th><th className="p-2">p95 (ms)</th></tr></thead><tbody>{Object.entries(data.timings).map(([key,row])=><tr className="border-t border-line" key={key}><td className="p-2">{timingNames[key]??key}</td><td className="p-2">{row.count}</td><td className="p-2">{row.p50??'ไม่ทราบ'}</td><td className="p-2">{row.p95??'ไม่ทราบ'}</td></tr>)}</tbody></table></div>{!Object.keys(data.timings).length?<p className="mt-3 text-sm text-muted">ยังไม่มีตัวอย่างใน process นี้ ไม่ใช่ผลยืนยันว่าเร็วหรือไม่มีปัญหา</p>:null}</Card>
      <FeedSampleAudit sources={data.sources}/>
    </>:loading?<p className="text-sm text-muted">กำลังโหลดข้อมูลแหล่ง…</p>:null}
    <Card><h2 className="mb-3 font-semibold">เส้นทางงานและหลักฐานคอมเมนต์</h2><CommentEvidenceInspector/></Card>
    <Card><h2 className="font-semibold">ตรวจความต่อเนื่อง</h2><p className="mt-2 text-sm">เก็บรายงานต่อเนื่อง 24–72 ชั่วโมงจากเครื่องที่รัน MY-BOT ด้วย <code>npm run observe:automation -- --hours=24 --interval-seconds=60</code> เครื่องมือนี้อ่านสถิติ ไม่เปิดอ่านกลุ่มหรือเปิดส่งแทนเจ้าของ</p><p className="mt-2 text-xs text-muted">การผ่านช่วงสั้นไม่แทนผลครบวัน ต้องตรวจช่วงขาดหาย รุ่นอุปกรณ์ งานค้าง และสิ่งที่ยังไม่ทราบในรายงาน</p></Card>
  </div>;
}
