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
          <li>สรุปรายวันส่งตอนเช้า ปรับเวลาและ Discord ได้ในหน้าตั้งค่า</li>
        </ol>
      </Card>
      <Card className="space-y-2 text-sm leading-6">
        <h2 className="font-semibold">AI ที่ไม่เสียเงิน</h2>
        <p>Ollama บนเครื่องใช้ qwen2.5:7b สำหรับจัดหมวด และ bge-m3 สำหรับค้นตามความหมาย การ์ดจอประมาณ RTX 3060 หรือแรม 32 GB รัน 7b ได้สบาย ถ้าแรมการ์ดจอน้อยให้เลือก qwen2.5:3b ตอนติดตั้ง</p>
        <p>ถ้าพอร์ต 11434 ถูก Windows จองไว้ ระบบและสคริปต์ติดตั้งจะย้าย Ollama ไป 41434</p>
        <p>ไม่มี Ollama ก็ใส่คีย์ Groq หรือ Gemini แพลนฟรีใน .env ได้ ระบบจะข้ามตัวที่ใช้ไม่ได้</p>
      </Card>
    </div>
  );
}
