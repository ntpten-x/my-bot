"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";
import { ApiError, api } from "@/components/api";

export default function LoginPage() {
  const router = useRouter();
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
      const result = await api<{ weakPassword?: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      router.replace(result.weakPassword ? "/settings/security" : "/dashboard");
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
      <p className="mt-2 text-sm leading-6 text-muted">เรดาร์ลีดเครื่องนี้มีเจ้าของคนเดียว ใส่รหัสผ่านที่ตั้งไว้ตอนแรก</p>
      <Card className="mt-6">
        {ready ? (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="password">รหัสผ่าน</Label>
              <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
            </div>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "กำลังตรวจ..." : "เข้าสู่ระบบ"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted">กำลังตรวจสถานะ...</p>
        )}
      </Card>
    </main>
  );
}
