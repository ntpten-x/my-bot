"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/components/api";

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((response) => response.json())
      .then((data) => {
        if (data.authenticated) router.replace("/dashboard");
        else if (!data.needsSetup) router.replace("/login");
        else setReady(true);
      })
      .catch(() => setReady(true));
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/setup", { method: "POST", body: JSON.stringify({ username, password, confirm, bootstrapToken }) });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ตั้งรหัสผ่านไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <p className="text-xs tracking-[0.18em] text-clay">ครั้งแรกบนเครื่องนี้</p>
      <h1 className="mt-2 text-3xl font-semibold">ตั้งรหัสผ่านเจ้าของ</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        MY-BOT ไม่มีสมัครสมาชิกและไม่มีระบบเก็บเงิน รหัสนี้ใช้เปิดหน้าเว็บบนเครื่องคุณเท่านั้น อย่างน้อย 8 ตัว
      </p>
      <Card className="mt-6">
        {ready ? (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="username">ชื่อผู้ใช้</Label>
              <Input id="username" autoComplete="username" required minLength={3} maxLength={64} pattern="[A-Za-z0-9_.-]+" value={username} onChange={event => setUsername(event.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="password">รหัสผ่าน</Label>
              <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="confirm">ยืนยันรหัสผ่าน</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            </div>
            <div><Label htmlFor="bootstrap-token">รหัสตั้งระบบครั้งแรก (BOOTSTRAP_TOKEN บนเซิร์ฟเวอร์; ต้องใช้ใน production รวมถึง local production)</Label><Input id="bootstrap-token" type="password" autoComplete="off" value={bootstrapToken} onChange={event => setBootstrapToken(event.target.value)} /></div>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "กำลังบันทึก..." : "เริ่มใช้ MY-BOT"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted">กำลังตรวจสถานะ...</p>
        )}
      </Card>
    </main>
  );
}
