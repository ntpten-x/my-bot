"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Button, Card } from "@/components/ui";
import type { automationReadiness } from "@/lib/automation-readiness";
type Data = Awaited<ReturnType<typeof automationReadiness>>;

export default function GettingStarted() {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(signal?: AbortSignal) {
    setBusy(true);
    try { setData(await api<Data>("/api/automation-readiness", { signal })); setError(""); }
    catch { if (!signal?.aborted) setError("ตรวจความพร้อมไม่สำเร็จ กรุณาลองใหม่"); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);
  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">เริ่มใช้งานและตรวจความพร้อม</h1>
    <p className="text-sm text-muted">เว็บและ AI ทำงานบนเซิร์ฟเวอร์ ส่วน Chrome บนเครื่องคุณอ่านกลุ่มและส่งคอมเมนต์ผ่านหน้าจอ ต้องเปิดเครื่องและล็อกอิน Facebook ไว้ สถานะพร้อมเป็นผลตรวจการตั้งค่า ยังไม่รับรองสิทธิ์กลุ่มหรือผลการส่ง</p>
    <Button variant="outline" disabled={busy} onClick={() => void load()}>{busy ? "กำลังตรวจ..." : "ตรวจอีกครั้ง"}</Button>
    {error ? <p role="alert">{error}</p> : null}
    <ol className="space-y-3">{data?.steps.map((step, index) => <li key={step.key}><Card><div className="flex justify-between gap-3"><h2 className="font-medium">{index + 1}. {step.title}</h2><span>{step.ready ? "พร้อมตามการตั้งค่า" : "ต้องตรวจเพิ่ม"}</span></div><p className="my-2 text-sm text-muted">{step.detail}</p><Link href={step.href} className="text-sm underline">เปิดหน้าตั้งค่า</Link></Card></li>)}</ol>
    <Card><h2 className="font-medium">สถานะเครื่องอ่านและเครื่องส่ง</h2>{data?.extensions.map(device => <div key={device.id} className="mt-3 border-t border-line pt-3 text-sm"><p>{device.name} · {device.online ? "ออนไลน์" : "ออฟไลน์/ยังไม่มีข้อมูลรุ่นใหม่"}</p><p>Facebook: {device.fbUserId || "ยังไม่ทราบ"} · รับงานคอมเมนต์: {device.commentsEnabled ? "เปิด" : "ปิด"}</p>{device.quietReason ? <p>พักอ่าน: {device.quietReason}</p> : null}{device.reading?.groupName ? <p>กำลังอ่าน: {device.reading.groupName}{device.reading.phase === "detail" ? " (ข้อความเต็ม)" : ""}</p> : null}{device.commentPending ? <p>มีงานส่งที่ยังรอสรุปผล กรุณาตรวจประวัติ</p> : null}</div>)}<p className="mt-3 text-xs text-muted">ข้อมูลอาจช้าประมาณ 1 นาที ปิด Chrome หรือปิดเครื่องแล้วทั้งการอ่านและการส่งผ่าน Extension จะหยุด</p></Card>
    <Card><h2 className="font-medium">บัญชี Facebook ที่ Extension เคยพบ</h2><p className="text-xs text-muted">ไม่เก็บรหัสผ่านหรือ Facebook Token ข้อมูลจาก heartbeat ไม่ใช่การเชื่อม OAuth หรือการรับรองสิทธิ์กลุ่ม</p>{data?.accounts.map(account => <p key={account.id} className="mt-2 text-sm">{account.name || account.id} ({account.id}) · {account.loggedIn ? "เคยรายงานว่าเข้าสู่ระบบ" : "ออกจากระบบ"} · พบล่าสุด {new Date(account.lastSeenAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>)}</Card>
    <Card><h2 className="font-medium">ผลอ่านแต่ละแหล่ง</h2><p className="text-xs text-muted">เป็นสัญญาณจากรอบอ่าน ไม่ใช่จำนวนทั้งหมดใน Facebook หรือหลักฐานว่าเก็บครบ</p>{data?.sources.map(source => <div key={source.id} className="mt-3 text-sm"><p>{source.name} · {source.enabled ? "เปิด" : "ปิด"} · รอบล่าสุดพบ {source.found} / บันทึกใหม่ {source.inserted}</p><p>{source.coverage?.label ?? "ยังไม่มีข้อมูล"}</p>{source.coverage?.reasons.map(reason => <p key={reason} className="text-xs text-muted">{reason}</p>)}</div>)}</Card>
    <Card><p className="text-sm">ลำดับเปิดใช้: บันทึกกฎที่ปิดอยู่ → ผูกอุปกรณ์และบัญชี → ยืนยันสิทธิ์และกฎกลุ่ม → เปิดกฎ → Start ใน Dry Run → ตรวจข้อความ → เมื่อเจ้าของอนุมัติส่งจริง จึงปิด Dry Run และ Start ใหม่</p><p className="mt-2 text-xs text-muted">Emergency Stop ป้องกันการอนุญาตงานใหม่ แต่สิทธิ์กดส่งที่ออกไปก่อนหยุดอาจยังมีผลไม่เกิน 3 วินาที และคอมเมนต์ที่ส่งแล้วเรียกคืนไม่ได้</p></Card>
  </div>;
}
