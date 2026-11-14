"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Button, Card, Input, Label } from "@/components/ui";
import { api } from "@/components/api";
import { SecurityControls } from "@/components/security-controls";
import { AuthSessions } from "@/components/auth-sessions";

export default function SecurityPage() {
  const [weak, setWeak] = useState(false);
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionRefresh, setSessionRefresh] = useState(0);

  useEffect(() => {
    api<{ weak: boolean }>("/api/auth/change-password").then((d) => setWeak(d.weak)).catch(() => undefined);
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api("/api/auth/change-password", { method: "POST", body: JSON.stringify(form) });
      setForm({ current: "", next: "", confirm: "" });
      setWeak(false);
      setSessionRefresh(value => value + 1);
      setMessage("เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นที่ล็อกอินอยู่ถูกออกจากระบบ");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/settings" className="text-sm text-muted">← ตั้งค่า</Link>
        <h1 className="text-2xl font-semibold">ความปลอดภัย</h1>
      </div>
      {weak && (
        <Card className="border-amber-300 bg-amber-50">
          <p className="font-semibold">รหัสผ่านปัจจุบันอ่อนเกินไป</p>
          <p className="text-sm">เว็บนี้เปิดบนอินเทอร์เน็ตได้ แนะนำให้เปลี่ยนเป็นรหัสที่ยาวอย่างน้อย 12 ตัว มีตัวอักษร ตัวเลข และตัวพิมพ์ใหญ่หรือสัญลักษณ์</p>
        </Card>
      )}
      <Card>
        <form onSubmit={save} className="max-w-md space-y-3">
          <h2 className="font-semibold">เปลี่ยนรหัสผ่าน</h2>
          <div><Label>รหัสผ่านปัจจุบัน</Label><Input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></div>
          <div><Label>รหัสผ่านใหม่</Label><Input type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></div>
          <div><Label>ยืนยันรหัสผ่านใหม่</Label><Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></div>
          <p className="text-xs text-muted">อย่างน้อย 12 ตัว · มีตัวอักษรและตัวเลข · มีตัวพิมพ์ใหญ่หรือสัญลักษณ์ · ไม่ใช่รหัสที่คนใช้บ่อย</p>
          <Button type="submit" disabled={busy}>{busy ? "กำลังบันทึก…" : "เปลี่ยนรหัสผ่าน"}</Button>
          {message && <p className="text-sm">{message}</p>}
        </form>
        <p className="mt-4 text-xs text-muted">ล็อกอินผิด 5 ครั้งใน 15 นาที จะถูกล็อก 15 นาที</p>
      </Card>
      <SecurityControls />
      <AuthSessions refreshKey={sessionRefresh} />
    </div>
  );
}
