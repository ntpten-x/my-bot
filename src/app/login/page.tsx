"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";
import { ThemeToggle } from "@/components/layout/theme-toggle";
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
    <div className="relative min-h-screen bg-bg text-fg">
      <div className="absolute right-4 top-4 z-10 md:right-6 md:top-6">
        <ThemeToggle />
      </div>
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-fg md:text-5xl">MY-BOT</h1>
          <p className="mt-3 text-sm text-muted">เรดาร์ลีดส่วนตัวของเครื่องนี้</p>
        </div>
        <Card className="mt-8 border border-line bg-card p-5 shadow-none md:p-6">
          {ready ? (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="username">ชื่อผู้ใช้</Label>
                <Input id="username" autoComplete="username" required minLength={3} maxLength={64} pattern="[A-Za-z0-9_.-]+" value={username} onChange={event => setUsername(event.target.value)} autoFocus />
                <p className="mt-1 text-xs text-muted">บัญชีเดิมใช้ชื่อ admin</p>
              </div>
              <div>
                <Label htmlFor="password">รหัสผ่าน</Label>
                <Input id="password" type="password" autoComplete="current-password" required maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              <div>
                <Label htmlFor="otp">รหัส Authenticator (ถ้ามี)</Label>
                <Input id="otp" autoComplete="one-time-code" maxLength={64} value={code} onChange={event => setCode(event.target.value)} />
                <p className="mt-1 text-xs text-muted">เว้นว่างได้ถ้ายังไม่เปิด MFA</p>
              </div>
              {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
              </Button>
              <p className="text-center text-sm">
                <Link href="/reset-password" className="text-accent underline-offset-2 hover:underline">
                  ลืมรหัสผ่าน
                </Link>
              </p>
            </form>
          ) : (
            <p className="text-sm text-muted">กำลังเตรียมหน้าเข้าสู่ระบบ…</p>
          )}
        </Card>
      </main>
    </div>
  );
}
