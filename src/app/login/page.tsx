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
  const [showPassword, setShowPassword] = useState(false);
  const [showMfa, setShowMfa] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((response) => response.json())
      .then((data) => {
        if (data.authenticated) router.replace("/feed");
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
      const result = await api<{ weakPassword?: boolean; mfaSetupRequired?: boolean }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password, code }),
      });
      router.replace(result.weakPassword || result.mfaSetupRequired ? "/settings/security" : "/feed");
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "เข้าสู่ระบบไม่สำเร็จ";
      if (/Authenticator|กรอกรหัส(?!ผ่าน)/i.test(message)) {
        setShowMfa(true);
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg text-fg">
      <div
        data-login-atmosphere
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 55% at 50% -10%, color-mix(in oklab, var(--color-accent) 22%, transparent), transparent 70%), radial-gradient(ellipse 50% 40% at 100% 100%, color-mix(in oklab, var(--color-accent-soft) 80%, transparent), transparent 65%)",
        }}
      />
      <div className="absolute right-4 top-4 z-10 md:right-6 md:top-6">
        <ThemeToggle />
      </div>
      <main className="relative z-[1] mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-fg md:text-5xl">MY-BOT</h1>
          <p className="mt-3 text-sm text-muted">เรดาร์ลีดส่วนตัวของเครื่องนี้</p>
        </div>
        <Card className="mt-8 border border-line bg-card/95 p-5 shadow-none md:p-6">
          {ready ? (
            <form onSubmit={submit} className="space-y-5">
              <div>
                <Label htmlFor="username">ชื่อผู้ใช้</Label>
                <Input
                  id="username"
                  className="h-11"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[A-Za-z0-9_.-]+"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoFocus
                />
                <p className="mt-1 text-xs text-muted">บัญชีเดิมใช้ชื่อ admin</p>
              </div>
              <div>
                <Label htmlFor="password">รหัสผ่าน</Label>
                <div className="relative">
                  <Input
                    id="password"
                    className="h-11 pr-24"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    maxLength={200}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? "ซ่อน" : "แสดง"}
                  </button>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  className="text-sm text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  aria-expanded={showMfa}
                  onClick={() => {
                    if (showMfa) setCode("");
                    setShowMfa((value) => !value);
                  }}
                >
                  {showMfa ? "ซ่อนรหัส Authenticator" : "มีรหัส Authenticator"}
                </button>
                {showMfa ? (
                  <div className="mt-3">
                    <Label htmlFor="otp">รหัส Authenticator</Label>
                    <Input
                      id="otp"
                      className="h-11"
                      autoComplete="one-time-code"
                      maxLength={64}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted">เว้นว่างได้ถ้ายังไม่เปิด MFA</p>
                  </div>
                ) : null}
              </div>
              {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" disabled={busy} className="h-11 w-full">
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
