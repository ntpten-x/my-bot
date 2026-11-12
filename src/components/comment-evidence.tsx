"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { CommentEvidenceData } from "@/lib/auto-comment/evidence";

const duration = (value: number | null) => value == null ? "ไม่ทราบ" : `${(value / 1000).toLocaleString("th-TH", { maximumFractionDigits: 3 })} วินาที`;
const timestamp = (value: string | null) => value ? new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "ไม่ทราบ";
const timingLabel: Record<string, string> = { missing: "ไม่มีเวลาในข้อมูล", future: "เวลาอยู่ในอนาคต ตรวจนาฬิกาเครื่อง", out_of_order: "เวลาผิดลำดับ ช่วงรอไม่ทราบ" };

/** Mount only after an explicit inspection action; one GET per job, no polling or sending controls. */
export function CommentEvidence({ jobId, onClose }: { jobId: string; onClose?: () => void }) {
  const [result, setResult] = useState<{ id: string; data?: CommentEvidenceData; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/auto-comment/jobs/${encodeURIComponent(jobId)}/evidence`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("read_failed");
        const data: CommentEvidenceData = await response.json();
        if (!controller.signal.aborted) setResult({ id: jobId, data });
      } catch {
        if (!controller.signal.aborted) setResult({ id: jobId, error: "โหลดหลักฐานไม่สำเร็จ ตรวจการเข้าสู่ระบบและรหัสงาน" });
      }
    }
    void load();
    return () => controller.abort();
  }, [jobId]);
  const current = result?.id === jobId ? result : null;
  const data = current?.data;
  return <section className="space-y-4 rounded-xl border border-line bg-surface p-4" aria-label="หลักฐานคอมเมนต์">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">หลักฐานและลำดับเวลาคอมเมนต์</h3><p className="break-all text-xs text-muted">งาน {jobId} · อ่านอย่างเดียว</p></div>{onClose && <button type="button" className="text-sm underline" onClick={onClose}>ปิดหลักฐาน</button>}</div>
    {!current && <p role="status">กำลังโหลดหลักฐาน…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {data && <>
      <div className="space-y-1 text-sm">
        <p>สถานะ: {data.job.status} · วิธีส่ง: {data.job.deliveryMode} · จำนวนครั้ง: {data.job.attempts}{data.job.dryRun ? " · ประวัติจำลองเดิม" : ""}</p>
        <p>บัญชีที่ผูกกับงาน: {data.account ? `${data.account.name || "ไม่ทราบชื่อ"} (${data.account.id})` : "ไม่ทราบ"}</p>
        <div className="flex flex-wrap gap-4">{data.targetUrl ? <a href={data.targetUrl} target="_blank" rel="noopener noreferrer" className="underline">เปิดโพสต์เป้าหมาย</a> : <span>ลิงก์เป้าหมายตรวจสอบไม่ได้</span>}{data.commentUrl ? <a href={data.commentUrl} target="_blank" rel="noopener noreferrer" className="underline">เปิดคอมเมนต์ตามหลักฐาน</a> : <span>ไม่ทราบลิงก์คอมเมนต์: ไม่มีรหัสที่ยืนยันกับงานนี้ได้</span>}</div>
      </div>
      <div><p className="text-sm font-medium">ข้อความที่เก็บไว้ในงาน</p><p className="mt-1 whitespace-pre-wrap break-words rounded border border-line p-3 text-sm">{data.job.message}</p></div>
      <p className="text-xs text-muted">นับจากรับเข้าใช้ Post.createdAt ไม่ใช่เวลาเผยแพร่บน Facebook ช่วงรอนับจากขั้นก่อนหน้าที่แสดงเท่านั้น หากเวลาไม่ครบหรือผิดลำดับจะแสดงไม่ทราบ ข้อมูลเป็นสถานะปัจจุบันและบันทึกล่าสุด ไม่ใช่ประวัติทุกครั้งที่ประมวลผล</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-line"><th className="p-2">ขั้นตอน</th><th className="p-2">เวลา (กรุงเทพฯ)</th><th className="p-2">จากรับเข้า</th><th className="p-2">รอจากขั้นก่อนหน้า</th></tr></thead><tbody>{data.stages.map(stage => <tr key={stage.key} className="border-b border-line"><td className="p-2">{stage.label}{stage.timing !== "recorded" && <span className="block text-muted">{timingLabel[stage.timing]}</span>}</td><td className="p-2">{timestamp(stage.at)}</td><td className="p-2">{duration(stage.elapsedFromIngestMs)}</td><td className="p-2">{duration(stage.waitFromPreviousMs)}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-muted">สถานะประมวลผลโพสต์: {data.processing.state ?? "ไม่ทราบ"} · ไม่มีเวลาจบประมวลผลแยกในข้อมูลเดิม สถานะ AI: {data.ai?.status ?? "ไม่ทราบ/ไม่มีงาน AI ที่เก็บไว้"} · ผลประเมินล่าสุด: {data.evaluation?.state ?? "ไม่ทราบ"} การไม่มีงาน AI ไม่ยืนยันว่า AI ทำสำเร็จ และกฎคำสำคัญอาจไม่ใช้ AI</p>
      <div className="space-y-1 text-xs text-muted"><p>ภาพข้อมูล AI / การประเมินล่าสุด แยกจากลำดับส่ง: ข้อมูลอาจเปลี่ยนหลังสร้างหรือส่งงาน จึงไม่ใช้คำนวณช่วงรอของงานนี้</p><p>AI เข้าคิว: {timestamp(data.ai?.queuedAt ?? null)} · แก้ไขสถานะล่าสุด: {timestamp(data.ai?.recordUpdatedAt ?? null)} · ระยะประมวลผลที่บันทึก: {duration(data.ai?.latencyMs ?? null)} · รอคิวที่บันทึก: {duration(data.ai?.queueWaitMs ?? null)}</p><p>ประเมินกฎล่าสุด: {timestamp(data.evaluation?.evaluatedAt ?? null)} (อาจประเมินซ้ำภายหลัง)</p></div>
      <p className="text-xs text-muted">แสดงบันทึกล่าสุด {data.coverage.returnedLogs} จาก {data.coverage.totalLogs} รายการ{data.coverage.truncated ? " · ตัดบันทึกเก่าออกจากรายการนี้" : ""} เวลาเตรียมพร้อม/พบคอมเมนต์อ่านบันทึกแรกของขั้นนั้นแยกต่างหาก</p>
      {data.logs.length > 0 && <details><summary className="cursor-pointer text-sm">บันทึกเหตุการณ์ล่าสุด (ไม่แสดงข้อมูลสิทธิ์ส่ง)</summary><ul className="mt-2 space-y-1 text-xs">{data.logs.map(log => <li key={log.id}>{timestamp(log.at)} · {log.event}</li>)}</ul></details>}
      {data.job.status === "uncertain" && <div className="space-y-2 rounded border border-amber-500/40 p-3 text-sm"><p className="font-medium">ผลไม่แน่นอน — ตรวจเอง และไม่ส่งซ้ำ</p><ol className="list-decimal space-y-1 pl-5"><li>เปิดโพสต์เป้าหมายด้วยบัญชีที่ผูกกับงาน ตรวจข้อความและคอมเมนต์ด้วยตนเอง</li><li>เทียบข้อความที่เก็บไว้กับคอมเมนต์จริง รวมถึงเวลาและบัญชี อย่าสรุปว่าไม่ส่งเพียงเพราะยังหาไม่พบ</li><li>หากมี journal ค้าง ใช้ popup ส่วนขยาย “ปลดล็อกบนเครื่องหลังตรวจผลเองแล้ว” และบันทึกผลตรวจตามที่พบ</li></ol><p>การบันทึกผลตรวจใน popup ปลด journal บนเครื่องหลังเซิร์ฟเวอร์รับผล ไม่ล้างประวัติงานหรือส่งงานเดิมใหม่ หน้านี้ไม่เปลี่ยนสถานะ ไม่ให้สิทธิ์ส่ง และไม่ลองส่งซ้ำ</p></div>}
      <p className="text-xs text-muted">การพบในหน้าจอเป็นรายงานของส่วนขยาย ไม่ใช่การยืนยันจาก API และบันทึก dispatch เป็นการอนุญาต/จองการส่งเท่านั้น</p>
    </>}
  </section>;
}

export function CommentEvidenceInspector({ jobId }: { jobId?: string } = {}) {
  const [input, setInput] = useState(jobId ?? "");
  const [selected, setSelected] = useState(jobId ?? "");
  function inspect(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (input.trim()) setSelected(input.trim()); }
  return <div className="space-y-3"><form onSubmit={inspect} className="flex flex-wrap items-end gap-2"><label className="text-sm">รหัสงานคอมเมนต์<input value={input} onChange={event => setInput(event.target.value)} maxLength={100} required className="mt-1 block rounded border border-line bg-surface p-2" /></label><button type="submit" className="rounded border border-line px-3 py-2 text-sm">ตรวจหลักฐาน</button></form>{selected && <CommentEvidence jobId={selected} onClose={() => setSelected("")} />}</div>;
}
