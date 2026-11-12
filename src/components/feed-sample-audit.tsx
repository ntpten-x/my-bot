"use client";

import React, { useEffect, useRef, useState } from "react";
import type { FeedSampleInput, FeedSampleReport, SampleIntent } from "@/lib/feed-sample-audit";

type SourceOption = { id: string; name: string; type: string };
const intents = ["buyer", "seller", "ad", "unknown"] as const;
const statusNames: Record<string,string> = {found:"พบในฐานข้อมูล",missing:"ไม่พบในฐานข้อมูล",lookup_limited:"ไม่ทราบ (ถึงขีดจำกัดการค้น)",invalid_url:"URL ไม่ถูกต้อง",unrecognized_url:"ไม่รู้จัก URL โพสต์",source_mismatch:"ไม่ตรงกับแหล่งข้อมูล"};
const percent=(value:number|null)=>value===null?"ไม่ทราบ / ไม่มีตัวหาร":`${(value*100).toFixed(1)}%`;

export function FeedSampleAudit({ sources }: { sources: SourceOption[] }) {
  const eligible=sources.filter(source=>["facebook_group","facebook_marketplace"].includes(source.type));
  const [sourceId,setSourceId]=useState(eligible[0]?.id??"");
  const [text,setText]=useState("");
  const [expectedFullText,setExpectedFullText]=useState(false);
  const [report,setReport]=useState<FeedSampleReport|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  useEffect(()=>{
    const available=sources.filter(source=>["facebook_group","facebook_marketplace"].includes(source.type));
    setSourceId(current=>available.some(source=>source.id===current)?current:available[0]?.id??"");
  },[sources]);

  async function audit(event:React.FormEvent) {
    event.preventDefault();if(busy)return;setError("");setReport(null);
    const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if (!sourceId || !lines.length || lines.length>50) {setError("เลือกแหล่งข้อมูลและระบุ 1–50 รายการ");return;}
    const items:FeedSampleInput[]=[];
    for (const line of lines) {
      const [url,label,fullText,...extra]=line.split("|").map(part=>part.trim());
      if (extra.length || (label && !intents.includes(label as SampleIntent)) || (fullText && !["true","false"].includes(fullText))) {setError("รูปแบบ: URL | buyer/seller/ad/unknown | true/false (สองช่องท้ายเว้นว่างได้)");return;}
      items.push({url,...(label?{expectedIntent:label as SampleIntent}:{}),...(fullText?{expectedFullText:fullText==="true"}:{})});
    }
    const body=JSON.stringify({sourceId,items,expectedFullText});
    if (new TextEncoder().encode(body).byteLength>32768) {setError("ข้อมูลเกิน 32 KiB");return;}
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    setBusy(true);
    try {
      const response=await fetch("/api/automation-quality/feed-audit",{method:"POST",headers:{"Content-Type":"application/json"},body,signal:controller.signal});
      const data=await response.json();
      if (!response.ok) throw new Error(data.error||"ตรวจตัวอย่างไม่สำเร็จ");
      if(!controller.signal.aborted)setReport(data);
    } catch(cause) {if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"ตรวจตัวอย่างไม่สำเร็จ");}
    finally {if(!controller.signal.aborted)setBusy(false);}
  }
  function download() {
    if (!report) return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));
    const anchor=document.createElement("a");anchor.href=url;anchor.download=`mybot-feed-audit-${report.generatedAt.slice(0,10)}.json`;anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  return <section className="space-y-4 rounded-xl border p-4">
    <h2 className="text-lg font-semibold">ตรวจตัวอย่างโพสต์จากฟีด</h2>
    <p className="text-sm text-muted-foreground">เลือกตัวอย่างที่เห็นด้วยตนเองได้สูงสุด 50 URL ต่อครั้ง เปรียบเทียบกับข้อมูลที่เก็บแล้ว ไม่ใช่ recall ของฟีดทั้งหมด การตรวจนี้อ่านฐานข้อมูลเท่านั้น</p>
    <form onSubmit={audit} className="space-y-3">
      <label className="block text-sm">แหล่งข้อมูล<select className="mt-1 block w-full rounded border bg-background p-2" value={sourceId} onChange={event=>setSourceId(event.target.value)} disabled={busy}>
        {!eligible.length&&<option value="">ยังไม่มีแหล่งข้อมูล Facebook</option>}{eligible.map(source=><option key={source.id} value={source.id}>{source.name}</option>)}
      </select></label>
      <label className="block text-sm">URL โพสต์ หนึ่งรายการต่อบรรทัด<textarea className="mt-1 block min-h-36 w-full rounded border bg-background p-2 font-mono" value={text} onChange={event=>setText(event.target.value)} placeholder="https://www.facebook.com/groups/123/posts/456 | buyer | true" disabled={busy}/></label>
      <p className="text-xs text-muted-foreground">รูปแบบ URL | buyer/seller/ad/unknown | true/false โดยป้ายกำกับและข้อกำหนดข้อความเต็มเว้นว่างได้ unknown คือป้ายกำกับจริง ส่วนช่องว่างคือยังไม่ได้กำกับ</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={expectedFullText} onChange={event=>setExpectedFullText(event.target.checked)} disabled={busy}/>ต้องการข้อความเต็มสำหรับทุกรายการที่ไม่ได้ระบุ true/false</label>
      <button type="submit" disabled={busy||!eligible.length} className="rounded border px-3 py-2 disabled:opacity-50">{busy?"กำลังตรวจ…":"ตรวจตัวอย่าง"}</button>
    </form>
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    {report&&<div className="space-y-3">
      <p className="text-sm">ตัวอย่างไม่ซ้ำ {report.counts.unique} · พบ {report.counts.found} · ไม่พบ {report.counts.missing} · ไม่ทราบ {report.counts.lookupUnknown} · ตัดทอน {report.counts.truncated} · URL ใช้ไม่ได้ {report.counts.invalid} · ลิงก์ซ้ำ {report.counts.duplicates}</p>
      <p className="text-sm">สัดส่วนที่พบในตัวอย่าง: {percent(report.sampleCoverage)} · พบและมีป้ายกำกับ {report.counts.labeledCaptured} · มีป้ายกำกับแต่ไม่พบ {report.counts.labeledMissing} · ไม่กำกับ/ขัดแย้ง {report.counts.unlabeled} (ขัดแย้ง {report.counts.labelConflicts})</p>
      <p className="text-xs text-muted-foreground">{report.caveat}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left">คุณภาพป้ายกำกับเฉพาะตัวอย่างที่พบและมีป้ายกำกับ</caption><thead><tr><th>ป้ายกำกับ</th><th>Precision</th><th>Recall</th><th>ตัวหารทำนาย / คาดหวัง</th></tr></thead><tbody>{intents.map(intent=><tr key={intent}><td>{intent}</td><td>{percent(report.classification[intent].precision)}</td><td>{percent(report.classification[intent].recall)}</td><td>{report.classification[intent].predicted} / {report.classification[intent].expected}</td></tr>)}</tbody></table></div>
      <details><summary className="cursor-pointer">รายละเอียด {report.results.length} รายการ</summary><ol className="mt-2 space-y-3">{report.results.map((row,index)=><li key={index} className="rounded border p-2 text-sm">
        <p>{index+1}. {statusNames[row.status]??row.status} {row.url&&<a href={row.url} target="_blank" rel="noreferrer" className="underline">เปิดโพสต์</a>}</p>
        <p>คาดหวัง: {row.labelConflict?"ป้ายกำกับขัดแย้ง":row.expectedIntent??"ยังไม่กำกับ"} · ผล: {row.actualIntent??"ไม่ทราบ"} · ข้อความ: {row.fullText==="truncated"?"ตัดทอน":row.fullText==="not_marked_truncated"?"ไม่ถูกทำเครื่องหมายว่าตัดทอน":"ไม่ทราบ"} · ต้องการข้อความเต็ม: {row.expectedFullText?"ใช่":"ไม่ได้กำหนด"}</p>
        <p>รับเข้า: {row.ingestedAt??"ไม่ทราบ"} · เวลาโพสต์: {row.postedAt??"ไม่ทราบ"} · เวลาดึง: ไม่ทราบ · ประมวลผล: {row.processingStatus} · งาน AI: {row.aiStatus} · ผู้ให้บริการ: {row.aiProvider??"ไม่ทราบ"}</p>
      </li>)}</ol></details>
      <button type="button" onClick={download} className="rounded border px-3 py-2">ดาวน์โหลดผล JSON (ไม่มีข้อความโพสต์)</button>
    </div>}
  </section>;
}
