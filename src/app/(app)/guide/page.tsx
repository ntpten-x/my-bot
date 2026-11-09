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
      <Card className="space-y-2">
        <h2 className="font-semibold">ทำงานต่อเนื่องบนเครื่องบอท</h2>
        <p className="text-sm text-muted">หากมีเครื่องเดียวและใช้ WSL ให้รัน <code>npm run browser:desktop</code> เพื่อเปิดเบราว์เซอร์บอทบนจอเสมือน ควบคุมได้ที่ localhost:6085 แล้วปิดหรือย่อ viewer ได้โดยให้โปรเซส WSL ทำงานต่อ ต้องตั้งรหัส viewer ล็อกอิน Facebook และจับคู่ส่วนขยายครั้งแรก ดู docs/SINGLE-PC-BOT.th.md</p>
        <p className="text-sm text-muted">เพื่อความเสถียร ให้ Chrome และส่วนขยายทำงานบนเครื่องเฉพาะที่เปิดเดสก์ท็อปและหน้าต่างบอทค้างไว้ ส่วนคุณใช้ MY-BOT จากเครื่องส่วนตัว การย่อ Chrome เครื่องส่วนตัวจึงไม่กระทบเครื่องบอท หากใช้ VM ต้องตรวจว่าการโหลด Facebook ยังคืบหน้าเมื่อย่อหรือออกจากหน้าจอควบคุม</p>
        <p className="text-sm text-muted">บนเครื่องบอท รัน <code>npm run browser:bot</code> เพื่อเปิดโปรไฟล์เฉพาะ แล้วล็อกอิน Facebook โหลดส่วนขยายและจับคู่อุปกรณ์ใหม่ หากเว็บอยู่คนละเครื่อง ต้องใช้ URL HTTPS ที่เครื่องบอทเข้าถึงได้ ดูขั้นตอนใน docs/BOT-WORKSTATION.th.md</p>
        <p className="text-sm text-muted">โปรไฟล์แยกบนเครื่องเดิมยังไม่แยกหน้าจอ และไม่แก้ข้อจำกัดเมื่อย่อหน้าต่าง การเตรียมนี้ไม่เปิดกฎส่งคอมเมนต์ให้อัตโนมัติ</p>
      </Card>
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
          <li>การดึงโพสต์บันทึกเป็นชุดแล้วอ่านต่อ เมื่อครบงบเวลาจะสลับกลุ่มและเก็บแท็บไว้เพื่อต่อจากเดิม โหมดตามเก็บไม่หยุดที่โพสต์เดิมด้านบน เก็บเฉพาะช่วงอายุที่ตั้งไว้ไม่เกิน 24 ชั่วโมง</li>
          <li>ดู “คิวรับโพสต์และการอ่านต่อ” ในภาพรวมระบบ เพื่อตรวจข้อมูลรอส่ง แท็บที่อ่านค้าง และกลุ่มที่เลยเวลานัด หาก Facebook ขอเข้าสู่ระบบหรือตรวจสอบบัญชี ให้ดำเนินการเองใน Chrome แล้วระบบจึงอ่านต่อได้</li>
          <li>อ่านฟีด กรองคะแนน บันทึกหรือกดไม่สนใจ เพื่อให้หน้าเรียนรู้จำคำที่ใช้บ่อย</li>
          <li>สรุปรายวันส่งหลังเวลาที่ตั้งไว้ (ค่าเริ่มต้น 08:00) ครั้งเดียวต่อวัน ถ้านาทีนั้นพลาด รอบถัดไปจะส่งให้</li>
          <li>สำรองฐานข้อมูลหลัง 03:00 ถ้าวันนั้นยังไม่เคยสำรอง ไฟล์อยู่ที่ data/backups</li>
        </ol>
      </Card>
      <Card className="space-y-2 text-sm leading-6">
        <h2 className="font-semibold">หลังอัปเดต</h2>
        <p>รัน npm run db:migrate แล้ว npm run db:seed จากนั้นเปิดแอปให้ worker จัดหมวดโพสต์เดิมใหม่ ถ้าต้องการลบประกาศตัวอย่างที่ปิดไว้ รัน npm run db:clean-samples</p>
        <p>หน้าแหล่งข้อมูลโชว์สาเหตุเมื่อดึงไม่สำเร็จ บันทึกงานของ worker อยู่ที่ data/mybot.log และข้อความจอของตัวเปิดอัตโนมัติอยู่ที่ data/mybot-console.log</p>
        <p>ตรวจว่าเว็บยังตอบโดยไม่ต้องเข้าสู่ระบบได้ที่ /api/v1/health จะได้เฉพาะ ok กับเลขเวอร์ชัน</p>
      </Card>
      <Card className="space-y-2 text-sm leading-6">
        <h2 className="font-semibold">บอททำงานด้วยกฎ</h2>
        <p>ระบบจัดหมวด เจตนา และคะแนนด้วยคำสำคัญ กฎภาษาไทย และข้อมูลประเภทสินค้า ไม่ต้องติดตั้งโมเดลหรือใส่คีย์ผู้ให้บริการ</p>
        <p>ปรับคำจับคู่ที่หน้าหมวดและประเภทสินค้า เพิ่มคำยกเว้นเพื่อลดโพสต์ผิดกลุ่ม ค้นโพสต์ด้วยคำจากข้อมูลทั้งหมดตามตัวกรอง</p>
        <p>คอมเมนต์ใช้เฉพาะข้อความสำเร็จรูปที่เลือกไว้ ยังคงตรวจบัญชี อุปกรณ์ กลุ่มที่อนุญาต วันเวลา โควตา และประวัติการส่งทุกครั้ง งานที่ไม่ทราบผลจะไม่ส่งซ้ำอัตโนมัติ</p>
        <p>หลังอัปเดต กฎเก่าที่ใช้ข้อความที่ระบบสร้างจะปิดไว้จนกว่าเจ้าของจะเลือกข้อความสำเร็จรูป ข้อมูลโพสต์และประวัติการส่งเดิมยังอยู่</p>
      </Card>
    </div>
  );
}
