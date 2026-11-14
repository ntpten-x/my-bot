"use client";
import { FormEvent, useEffect, useState } from "react";
import { Dialog } from "./dialog";
import { api } from "./api";
import { Button, Card, Input, Label } from "./ui";
type Status = { required?: boolean; available: boolean; enabled: boolean; recoveryCodesLeft: number };
export function SecurityControls() {
  const [status, setStatus] = useState<Status | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const abort = new AbortController(); api<Status>("/api/auth/mfa", { signal: abort.signal }).then(setStatus).catch(error => { if (!abort.signal.aborted) setMessage(error.message); }); return () => abort.abort(); }, []);
  useEffect(() => {
    const clear = () => { if (document.hidden) { setCodes([]); setEnrollment(null); setPassword(""); setCode(""); } };
    document.addEventListener("visibilitychange", clear); return () => document.removeEventListener("visibilitychange", clear);
  }, []);
  async function stepUp(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await api("/api/auth/step-up", { method: "POST", body: JSON.stringify({ password, code }) }); setPassword(""); setCode(""); setMessage("ยืนยันแล้ว ทำรายการสำคัญได้ใน 5 นาที"); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function mfa(action: "begin" | "confirm" | "disable" | "rotate") {
    setBusy(true); setMessage(""); setCodes([]);
    try {
      const result = await api<{ secret?: string; qr?: string; enabled?: boolean; recoveryCodes?: string[] }>("/api/auth/mfa", { method: "POST", body: JSON.stringify({ action, code }) });
      setCode("");
      if (result.secret && result.qr) setEnrollment({ secret: result.secret, qr: result.qr });
      else { setEnrollment(null); setCodes(result.recoveryCodes || []); setStatus(await api<Status>("/api/auth/mfa")); setMessage("บันทึกแล้ว เซสชันอุปกรณ์อื่นถูกเพิกถอน"); }
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <Card className="space-y-4">
    <h2 className="font-semibold">ยืนยันตัวตนและ MFA</h2>
    <p className="text-sm">เซสชันหมดอายุเมื่อไม่ใช้งาน 30 นาที และมีอายุสูงสุด 8 ชั่วโมง การตั้งค่าความปลอดภัยต้องยืนยันตัวตนภายใน 5 นาที</p>
    <form onSubmit={stepUp} className="max-w-md space-y-3">
      <div><Label htmlFor="step-up-password">รหัสผ่านสำหรับยืนยันอีกครั้ง</Label><Input id="step-up-password" type="password" autoComplete="current-password" required maxLength={200} value={password} onChange={event => setPassword(event.target.value)} /></div>
      <div><Label htmlFor="security-code">รหัส Authenticator หรือ recovery code (เมื่อเปิด MFA)</Label><Input id="security-code" autoComplete="one-time-code" maxLength={64} value={code} onChange={event => setCode(event.target.value)} /></div>
      <Button disabled={busy} type="submit">ยืนยันตัวตนอีกครั้ง</Button>
    </form>
    <p className="text-sm">MFA: {status ? status.enabled ? `เปิดแล้ว · recovery codes เหลือ ${status.recoveryCodesLeft}` : "ยังไม่เปิด — แนะนำให้ตั้งค่าตอนนี้" : "กำลังตรวจ…"}</p>
    {status?.available && !status.enabled && !enrollment ? <Button disabled={busy} onClick={() => void mfa("begin")}>ตั้งค่าแอป Authenticator</Button> : null}
    {status && !status.available ? <p className="text-sm">ระบบต้องได้รับการอัปเดตครบทุกเว็บก่อนเปิด MFA</p> : null}
    {enrollment ? <div className="space-y-3"><img src={enrollment.qr} width={240} height={240} alt="QR สำหรับตั้งค่า Authenticator เฉพาะเจ้าของ" /><p className="break-all font-mono text-sm">{enrollment.secret}</p><p className="text-sm">สแกนด้วยแอป Authenticator หรือกรอกคีย์เอง แล้วใส่รหัส 6 หลักในช่องด้านบนภายใน 10 นาที ห้ามแชร์คีย์นี้</p><Button disabled={busy || !code} onClick={() => void mfa("confirm")}>ยืนยันเปิด MFA</Button></div> : null}
    {status?.required ? <p className="text-xs text-muted">ระบบบังคับ MFA เมื่อปิดจะต้องตั้งค่าใหม่ก่อนกลับไปใช้งานหน้าอื่น</p> : null}
    {status?.enabled ? <div className="flex flex-wrap gap-2"><Button disabled={busy || !code} variant="outline" onClick={() => void mfa("rotate")}>สร้าง recovery codes ใหม่</Button><Button disabled={busy || !code} variant="danger" onClick={() => void mfa("disable")}>ปิด MFA ด้วยรหัสปัจจุบัน</Button></div> : null}
    {codes.length ? <div className="space-y-2"><p className="font-semibold">เก็บรหัสกู้คืนทันที แสดงครั้งเดียว แต่ละรหัสใช้ได้ครั้งเดียว</p><pre className="overflow-auto rounded bg-paper p-3 text-sm">{codes.join("\n")}</pre><Button onClick={() => { const blob = new Blob([codes.join("\n")], { type: "text/plain" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "mybot-recovery-codes.txt"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>บันทึกรหัสกู้คืน</Button><Button variant="outline" onClick={() => setCodes([])}>เก็บแล้ว ซ่อนรหัส</Button></div> : null}
    {status?.required && !status.enabled ? <Button variant="danger" disabled={busy} onClick={() => { setBusy(true); void api("/api/auto-comment", { method: "PUT", body: JSON.stringify({ action: "emergency" }) }).then(() => setMessage("หยุดคอมเมนต์ฉุกเฉินแล้ว")).catch(error => setMessage(error.message)).finally(() => setBusy(false)); }}>หยุดคอมเมนต์ฉุกเฉิน</Button> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    <p className="text-xs text-muted">Authenticator แต่ละรหัสใช้ได้ครั้งเดียว หากเพิ่งใช้ ให้รอรหัสรอบใหม่ หรือใช้ recovery code ที่ยังไม่เคยใช้ เก็บ recovery codes แยกจากอุปกรณ์หลัก</p>
  </Card>;
}

export function StepUpPrompt() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const show = () => { setOpen(true); setError(""); }; window.addEventListener("mybot:reauth-required", show); return () => window.removeEventListener("mybot:reauth-required", show); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/auth/step-up", { method: "POST", body: JSON.stringify({ password, code }) }); setOpen(false); setPassword(""); setCode(""); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  if (!open) return null;
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) { setPassword(""); setCode(""); } }} title="ยืนยันตัวตนก่อนทำรายการสำคัญ"><div className="space-y-3"><p className="text-sm">ยืนยันแล้วกดทำรายการเดิมอีกครั้ง ข้อมูลที่กำลังแก้ไขยังอยู่</p><form onSubmit={submit} className="space-y-3"><Label htmlFor="prompt-password">รหัสผ่าน</Label><Input id="prompt-password" type="password" required autoComplete="current-password" maxLength={200} value={password} onChange={event => setPassword(event.target.value)} /><Label htmlFor="prompt-code">Authenticator หรือ recovery code (เมื่อเปิด MFA)</Label><Input id="prompt-code" autoComplete="one-time-code" maxLength={64} value={code} onChange={event => setCode(event.target.value)} />{error ? <p role="alert">{error}</p> : null}<Button disabled={busy} type="submit">ยืนยัน</Button><Button type="button" variant="outline" onClick={() => { setOpen(false); setPassword(""); setCode(""); }}>ยกเลิก</Button></form></div></Dialog>;
}
