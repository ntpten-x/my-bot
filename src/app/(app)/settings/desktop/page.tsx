import Link from "next/link";
import { headers } from "next/headers";
import { Button, Card } from "@/components/ui";
import { DESKTOP_VERSION } from "@/lib/desktop-package";
import { selfOriginOf } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export default async function DesktopSettingsPage() {
  const requestHeaders = await headers();
  const origin = selfOriginOf(requestHeaders, "http://localhost");
  const available = origin.startsWith("https://") && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <Link href="/settings" className="text-sm text-muted hover:underline">← ตั้งค่า</Link>
        <h1 className="text-2xl font-semibold">MY-BOT Desktop</h1>
        <p className="max-w-2xl text-muted">ให้บอทอ่าน Facebook ในจอของตัวเอง คุณปิดหน้าดูบอทและใช้ Chrome ส่วนตัวต่อได้ ส่วนโพสต์และการจัดการยังอยู่บนเว็บนี้</p>
      </div>
      <Card className="space-y-4 border-pine/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">ส่วนเสริมสำหรับ Windows 11 แบบ x64</h2>
          <span className="text-sm text-muted">รุ่นทดลอง {DESKTOP_VERSION}</span>
        </div>
        <p className="text-sm">เลือกติดตั้งเมื่ออยากเก็บโพสต์โดยไม่ให้หน้าต่างบอทมาบังงาน ไม่จำเป็นสำหรับการใช้ส่วนขยายตามปกติ ครั้งแรกต้องดาวน์โหลดส่วนประกอบเพิ่มเติมและอาจต้องรีสตาร์ต Windows</p>
        {available ? <Button asChild variant="pine"><a href="/api/desktop-download">ดาวน์โหลดชุดติดตั้งรุ่นทดลอง .zip</a></Button>
          : <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">เปิด MY-BOT ผ่านที่อยู่ production แบบ HTTPS เพื่อดาวน์โหลดชุดที่เชื่อมกับเซิร์ฟเวอร์นั้น</p>}
        <p className="text-sm text-muted">รุ่นนี้ยังไม่ได้รับรองการติดตั้งบน Windows เครื่องใหม่ทุกแบบ ควรทดลองกับบัญชีของคุณก่อนใช้งานต่อเนื่อง ไม่ต้องใส่คีย์ API หรือข้อมูลฐานข้อมูลในเครื่อง</p>
      </Card>
      <section className="space-y-3" aria-labelledby="desktop-steps">
        <h2 id="desktop-steps" className="text-lg font-semibold">ติดตั้งครั้งแรก</h2>
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          <li>แตกไฟล์ที่ดาวน์โหลด แล้วเปิด <strong>Install.cmd</strong> ตรวจคำขออนุญาตก่อนติดตั้ง หาก Windows ต้องรีสตาร์ต ให้กลับมาเปิดตัวติดตั้งอีกครั้ง</li>
          <li>ตั้งรหัสสำหรับเปิดดูจอบอท แยกจากรหัส Facebook</li>
          <li>ในจอบอท เข้าสู่ MY-BOT เพื่อเชื่อมส่วนขยายอัตโนมัติ แล้วเข้าสู่ Facebook ด้วยตนเอง ไม่ต้องคัดลอกรหัสจับคู่หรือข้อมูลเข้าสู่ระบบจาก Chrome ส่วนตัว</li>
          <li>ตรวจบัญชีและโพสต์ล่าสุดใน <Link className="underline" href="/overview">ภาพรวมระบบ</Link> แล้วปิดหน้าดูจอได้ ใช้ทางลัด MY-BOT Desktop ในเมนูเริ่มเพื่อเปิดดู หยุด หรือตรวจสถานะ</li>
        </ol>
      </section>
      <Card className="space-y-2 text-sm">
        <h2 className="font-semibold">ปิดหน้าดูจอได้ แต่เครื่องต้องทำงานอยู่</h2>
        <p>เมื่อเครื่อง Sleep ปิดเครื่อง หรืออินเทอร์เน็ตขาด บอทในเครื่องจะอ่านต่อไม่ได้ หากพับฝาโน้ตบุ๊ก ต้องตรวจว่าเครื่องยังตื่นอยู่ โปรแกรมไม่เปลี่ยนการตั้งค่าพลังงานให้เอง</p>
        <p>อย่าย่อเบราว์เซอร์ภายในจอบอท การติดตั้งไม่เปิดส่งคอมเมนต์ ไม่เปลี่ยนโควตา และไม่ย้ายสิทธิ์จากอุปกรณ์เดิม ข้อมูลเข้าสู่ระบบเก็บในเครื่องนี้</p>
      </Card>
      <p className="text-sm text-muted">อัปเดตรุ่นทดลองโดยหยุดบอทจากทางลัดก่อน แล้วดาวน์โหลดชุดใหม่จากเว็บเดิมและติดตั้งทับ การจับคู่และข้อมูลค้างจะถูกเก็บไว้ หากต้องการเอาออก ให้ใช้คำสั่งถอนในคู่มือ ส่วนข้อมูลเข้าสู่ระบบจะไม่ถูกลบทิ้งอัตโนมัติ</p>
    </div>
  );
}
