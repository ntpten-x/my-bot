"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { ApiError, api } from "@/components/api";

type Check = { id: string; status: "PASS" | "WARN" | "FAIL"; label: string; hint: string };

export default function GuidePage() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ checks: Check[] }>("/api/v1/health/doctor");
      setChecks(data.checks);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ตรวจระบบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">วิธีใช้ MY-BOT</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          คู่มือฉบับเต็มอยู่ที่ docs/SETUP.th.md หน้านี้สรุปขั้นตอนและตรวจเครื่องที่กำลังรันอยู่ โดยไม่แสดงคีย์ลับ
        </p>
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">ตรวจระบบบนเครื่องนี้</h2>
          <Button type="button" onClick={run} disabled={busy}>{busy ? "กำลังตรวจ..." : "ตรวจอีกครั้ง"}</Button>
        </div>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        {!checks && !error ? <p className="mt-3 text-sm text-muted">กดปุ่มเพื่อดูว่า Node, ฐานข้อมูล, Ollama, คีย์ และพอร์ต 8001 พร้อมหรือยัง</p> : null}
        <ul className="mt-4 space-y-2">
          {checks?.map((check) => (
            <li key={check.id} className="rounded-xl bg-paper px-3 py-2 text-sm">
              <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs ${check.status === "PASS" ? "bg-pine/15 text-pine" : check.status === "WARN" ? "bg-amber/40" : "bg-red-100 text-red-800"}`}>
                {check.status}
              </span>
              <span className="font-medium">{check.label}</span>
              {check.hint ? <p className="mt-1 text-muted">{check.hint}</p> : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-3 text-sm leading-6">
        <h2 className="font-semibold">ติดตั้งบนเครื่องใหม่</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>ติดตั้ง Git กับ Node.js 20 ถ้ายังไม่มี สคริปต์ติดตั้งหาให้ด้วย winget</li>
          <li>โคลนโปรเจกต์แล้วเปิด PowerShell ในโฟลเดอร์นั้น</li>
          <li>รัน powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1 หรือ npm run setup</li>
          <li>ใส่คีย์ Groq, Gemini, Discord ถ้ามี กด Enter เพื่อข้ามได้ ค่าจะไม่โชว์บนจอ</li>
          <li>เปิด http://localhost:8001 แล้วตั้งรหัสผ่านเจ้าของ</li>
        </ol>
      </Card>
      <Card className="space-y-3 text-sm leading-6">
        <h2 className="font-semibold">ใช้ทุกวัน</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Chrome เปิด chrome://extensions เปิดโหมดนักพัฒนา แล้วโหลดโฟลเดอร์ extension</li>
          <li>คัดลอกโทเคนจากหน้าตั้งค่าไปวางในป๊อปอัป ส่วนที่อยู่คือ http://localhost:8001</li>
          <li>หน้าแหล่งข้อมูล วางลิงก์กลุ่ม Facebook ที่คุณเป็นสมาชิก หนึ่งบรรทัดต่อหนึ่งกลุ่ม</li>
          <li>อ่านฟีด กรองคะแนน บันทึกหรือกดไม่สนใจ เพื่อให้หน้าเรียนรู้จำคำที่ใช้บ่อย</li>
          <li>สรุปรายวันส่งหลังเวลาที่ตั้งไว้ (ค่าเริ่มต้น 08:00) ครั้งเดียวต่อวัน ถ้านาทีนั้นพลาด รอบถัดไปจะส่งให้</li>
          <li>สำรองฐานข้อมูลหลัง 03:00 ถ้าวันนั้นยังไม่เคยสำรอง ไฟล์อยู่ที่ data/backups</li>
        </ol>
      </Card>
      <Card className="space-y-2 text-sm leading-6">
        <h2 className="font-semibold">หลังอัปเดต</h2>
        <p>รัน npm run db:migrate แล้ว npm run db:seed จากนั้นเปิดแอปให้ worker จัดหมวดโพสต์เดิมใหม่ ถ้าต้องการลบประกาศตัวอย่างที่ปิดไว้ รัน npm run db:clean-samples</p>
        <p>หน้าแหล่งข้อมูลโชว์สาเหตุเมื่อดึงไม่สำเร็จ บันทึกงานของ worker อยู่ที่ data/mybot.log มีรหัสงาน ผู้ให้บริการ AI เวลาที่ใช้ และข้อผิดพลาด</p>
        <p>ตรวจว่าเว็บยังตอบโดยไม่ต้องเข้าสู่ระบบได้ที่ /api/v1/health จะได้เฉพาะ ok กับเลขเวอร์ชัน</p>
      </Card>
      <Card className="space-y-2 text-sm leading-6">
        <h2 className="font-semibold">AI ที่ไม่เสียเงิน</h2>
        <p>Ollama บนเครื่องใช้ qwen2.5:7b สำหรับจัดหมวด และ bge-m3 สำหรับค้นตามความหมาย การ์ดจอประมาณ RTX 3060 หรือแรม 32 GB รัน 7b ได้สบาย ถ้าแรมการ์ดจอน้อยให้เลือก qwen2.5:3b ตอนติดตั้ง</p>
        <p>ถ้าพอร์ต 11434 ถูก Windows จองไว้ ระบบและสคริปต์ติดตั้งจะย้าย Ollama ไป 41434</p>
        <p>สคริปต์ติดตั้งตั้ง OLLAMA_MAX_LOADED_MODELS=2 และ OLLAMA_KEEP_ALIVE=30m ให้โปรเซส Ollama เพื่อไม่ให้โมเดลแชทกับโมเดลค้นสลับกันทั้งวัน ถ้า Ollama เปิดค้างอยู่ก่อนติดตั้ง ให้ปิดแล้วเปิดใหม่</p>
        <p>ไม่มี Ollama ก็ใส่คีย์ Groq หรือ Gemini แพลนฟรีใน .env ได้ ระบบจะข้ามตัวที่ใช้ไม่ได้ โพสต์ใหม่ถูกเข้าคิวเสมอ และ worker เป็นตัวเดียวที่จัดหมวด โพสต์เก่ายังเป็นกฎจะถูกเข้าคิวอีกครั้งตอนเปิดแอป หรือรัน npm run db:backfill-ai</p>
      </Card>
    </div>
  );
}
