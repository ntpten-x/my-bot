"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((response) => response.json())
      .then((data) => {
        if (data.authenticated) router.replace("/dashboard");
        else if (data.needsSetup) router.replace("/setup");
        else setReady(true);
      })
      .catch(() => setReady(true));
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, bootstrapToken, password, confirm }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.needsSetup) {
        router.replace("/setup");
        return;
      }
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "รีเซ็ตรหัสผ่านไม่สำเร็จ");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("รีเซ็ตรหัสผ่านไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <p className="text-xs tracking-[0.18em] text-clay">MY-BOT</p>
      <h1 className="mt-2 text-3xl font-semibold">รีเซ็ตรหัสผ่าน</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        ใช้รหัสตั้งระบบครั้งแรก (`BOOTSTRAP_TOKEN` บนเซิร์ฟเวอร์) เพื่อตั้งรหัสเจ้าของใหม่ ข้อมูลลีดยังอยู่ localhost เว้นช่องนี้ได้
      </p>
      <Card className="mt-6">
        {ready ? (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="bootstrap-token">รหัสตั้งระบบครั้งแรก</Label>
              <Input
                id="bootstrap-token"
                type="password"
                autoComplete="off"
                value={bootstrapToken}
                onChange={(event) => setBootstrapToken(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="password">รหัสผ่านใหม่</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="confirm">ยืนยันรหัสผ่านใหม่</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <div><Label>Authenticator หรือ recovery code (เมื่อเปิด MFA)</Label><Input autoComplete="one-time-code" maxLength={64} value={code} onChange={event => setCode(event.target.value)} /></div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "กำลังบันทึก..." : "ตั้งรหัสผ่านใหม่"}
            </Button>
            <p className="text-center text-sm text-muted">
              <Link href="/login" className="text-clay underline-offset-2 hover:underline">
                กลับไปเข้าสู่ระบบ
              </Link>
            </p>
          </form>
        ) : (
          <p className="text-sm text-muted">กำลังตรวจสถานะ...</p>
        )}
      </Card>
    </main>
  );
}
