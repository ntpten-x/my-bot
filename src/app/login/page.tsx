"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/components/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
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
      const result = await api<{ weakPassword?: boolean; mfaSetupRequired?: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password, code }) });
      router.replace(result.weakPassword || result.mfaSetupRequired ? "/settings/security" : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <p className="text-xs tracking-[0.18em] text-clay">MY-BOT</p>
      <h1 className="mt-2 text-3xl font-semibold">เข้าสู่ระบบ</h1>
      <p className="mt-2 text-sm leading-6 text-muted">เรดาร์ลีดเครื่องนี้มีเจ้าของคนเดียว ใส่ชื่อผู้ใช้และรหัสผ่านเดิม (บัญชีเดิมใช้ชื่อ admin)</p>
      <Card className="mt-6">
        {ready ? (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="username">ชื่อผู้ใช้</Label>
              <Input id="username" autoComplete="username" required minLength={3} maxLength={64} pattern="[A-Za-z0-9_.-]+" value={username} onChange={event => setUsername(event.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="password">รหัสผ่าน</Label>
              <Input id="password" type="password" autoComplete="current-password" required maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <div><Label htmlFor="otp">รหัส Authenticator หรือ recovery code (ถ้าเปิด MFA)</Label><Input id="otp" autoComplete="one-time-code" maxLength={64} value={code} onChange={event => setCode(event.target.value)} /></div>
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "กำลังตรวจ..." : "เข้าสู่ระบบ"}
            </Button>
            <p className="text-center text-sm text-muted">
              <Link href="/reset-password" className="text-clay underline-offset-2 hover:underline">
                ลืมรหัสผ่าน
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
