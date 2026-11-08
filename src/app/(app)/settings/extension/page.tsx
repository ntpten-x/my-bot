"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { api } from "@/components/api";

type Device = { id: string; name: string; tokenHint: string; version: string | null; lastSeenAt: string | null; lastIp: string | null; revokedAt: string | null; createdAt: string };
type Data = { devices: Device[]; extensionVersion: string; appVersion: string; installedVersion: string | null; installedSeenAt: string | null };

function older(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  return false;
}

const when = (value: string | null) =>
  value ? new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-";

export default function ExtensionPage() {
  const [data, setData] = useState<Data | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(() => api<Data>("/api/extension-devices").then(setData).catch((e: Error) => setError(e.message)), []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== "mybot-ext" || event.data?.type !== "extension-connect-status") return;
      const state = String(event.data.state || "");
      setConnection(state);
      if (state === "connected") { setError(""); void load(); }
      else if (event.data.error) setError(String(event.data.error).slice(0, 200));
    };
    window.addEventListener("message", receive);
    window.postMessage({ source: "mybot-app", type: "extension-connect" }, window.location.origin);
    return () => window.removeEventListener("message", receive);
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const left = code ? Math.max(0, Math.floor((new Date(code.expiresAt).getTime() - now) / 1000)) : 0;
  useEffect(() => {
    if (code && left === 0) void load();
  }, [code, left, load]);

  const outdated = data?.installedVersion && older(data.installedVersion, data.extensionVersion);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/settings" className="text-sm text-muted">← ตั้งค่า</Link>
        <h1 className="text-2xl font-semibold">ส่วนขยาย Chrome</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">ติดตั้งแล้วเชื่อมต่อกับ MY-BOT ให้อัตโนมัติ ไม่ต้องกรอกที่อยู่เซิร์ฟเวอร์หรือรหัสจับคู่ การส่งคอมเมนต์ยังต้องเลือกอุปกรณ์ในกฎและกดเริ่มส่งจริงบนเว็บเอง</p>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {outdated && (
        <Card className="border-amber-300 bg-amber-50">
          <p className="font-semibold">มีอัปเดตส่วนขยาย</p>
          <p className="text-sm">เครื่องที่ส่งสัญญาณล่าสุดใช้ v{data!.installedVersion} แต่เซิร์ฟเวอร์มี v{data!.extensionVersion} ดาวน์โหลดใหม่ แตกไฟล์ทับโฟลเดอร์เดิม แล้วกด “โหลดซ้ำ” ที่ chrome://extensions</p>
        </Card>
      )}
      <Card className="space-y-3">
        <h2 className="font-semibold">1. ดาวน์โหลด</h2>
        <p className="text-sm">เวอร์ชันบนเซิร์ฟเวอร์: <Badge>v{data?.extensionVersion ?? "…"}</Badge>{" "}
          {data?.installedVersion && <>ติดตั้งล่าสุดที่เห็น: <Badge tone={outdated ? "amber" : "pine"}>v{data.installedVersion}</Badge> ({when(data.installedSeenAt)})</>}
        </p>
        <a href="/api/extension-download" className="inline-block rounded-xl bg-[#c24e1d] px-4 py-2 text-sm font-semibold text-white">ดาวน์โหลดไฟล์ .zip</a>
        <p className="text-sm text-muted">ไฟล์นี้ตั้งค่าให้เชื่อมกับ MY-BOT ที่คุณเปิดอยู่นี้แล้ว</p>
      </Card>
      <Card className="space-y-2">
        <h2 className="font-semibold">2. ติดตั้งใน Chrome</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>แตกไฟล์ zip จะได้โฟลเดอร์ <code>mybot-extension</code> (เก็บไว้ที่เดิม อย่าลบ)</li>
          <li>เปิด <code>chrome://extensions</code> ในแถบที่อยู่</li>
          <li>เปิด “โหมดนักพัฒนาซอฟต์แวร์” (Developer mode) มุมขวาบน</li>
          <li>กด “โหลดส่วนขยายที่แตกไฟล์แล้ว” (Load unpacked) แล้วเลือกโฟลเดอร์ <code>mybot-extension</code> — หรือลากโฟลเดอร์มาวางในหน้านั้น</li>
          <li>ปักหมุดไอคอน MY-BOT ไว้ที่แถบเครื่องมือ</li>
          <li>อัปเดต: แตกไฟล์ใหม่ทับโฟลเดอร์เดิม แล้วกดปุ่มโหลดซ้ำ ↻ ที่การ์ด MY-BOT</li>
        </ol>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">3. เชื่อมต่ออัตโนมัติ</h2>
        <p className="text-sm">หลังติดตั้ง ส่วนขยายจะเปิด MY-BOT ให้เอง หากยังไม่ได้เข้าสู่ระบบ ให้ล็อกอินครั้งเดียว ระบบจะลงทะเบียนอุปกรณ์ให้โดยไม่ต้องคัดลอกค่าใด ๆ จากนั้นเปิด Facebook และล็อกอินบัญชีที่ต้องการใช้</p>
        <p className="text-sm" role="status">{connection === "connected" ? "ส่วนขยายบันทึกการเชื่อมต่อแล้ว ตรวจสถานะอุปกรณ์ในรายการด้านล่าง" : connection === "connecting" ? "กำลังเชื่อมต่ออุปกรณ์นี้…" : "รอสัญญาณจากส่วนขยายที่ติดตั้งใน Chrome โปรไฟล์นี้"}</p>
        <Button type="button" variant="outline" onClick={() => window.postMessage({ source: "mybot-app", type: "extension-connect" }, window.location.origin)}>ตรวจการเชื่อมต่ออีกครั้ง</Button>
        <details>
        <summary className="cursor-pointer text-sm text-muted">วิธีจับคู่ด้วยรหัส สำหรับส่วนขยายรุ่นเก่า</summary>
        <p className="mt-2 text-sm">กรณีใช้วิธีเดิม: เปิดไอคอน MY-BOT ใส่ <code className="break-all">{origin}</code> และรหัสด้านล่าง รหัสใช้ได้ครั้งเดียวภายใน 10 นาที</p>
        {code && left > 0 ? (
          <div className="rounded-xl bg-paper p-3">
            <p className="font-mono text-3xl tracking-[0.3em]">{code.code}</p>
            <p className="text-sm text-muted">หมดอายุใน {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} นาที</p>
          </div>
        ) : null}
        <Button type="button" onClick={async () => {
          setError("");
          try {
            setCode(await api<{ code: string; expiresAt: string }>("/api/extension-devices/pairing-code", { method: "POST" }));
          } catch (e) {
            setError((e as Error).message);
          }
        }}>{code && left > 0 ? "สร้างรหัสใหม่" : "สร้างรหัสจับคู่"}</Button>
        </details>
      </Card>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">อุปกรณ์ที่จับคู่แล้ว</h2>
          <Button type="button" variant="outline" onClick={() => void load()}>รีเฟรช</Button>
        </div>
        {!data?.devices.length ? <p className="text-sm text-muted">ยังไม่มีอุปกรณ์</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="py-1">ชื่อ</th><th>โทเคน</th><th>เวอร์ชัน</th><th>ใช้ล่าสุด</th><th>สถานะ</th><th /></tr></thead>
              <tbody>
                {data.devices.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <td className="py-2">{d.name}</td>
                    <td className="font-mono">{d.tokenHint}</td>
                    <td>{d.version ?? "-"}</td>
                    <td>{when(d.lastSeenAt)}</td>
                    <td>{d.revokedAt ? <Badge>ยกเลิกแล้ว</Badge> : <Badge tone="pine">ใช้งาน</Badge>}</td>
                    <td className="text-right">{!d.revokedAt && (
                      <Button type="button" variant="danger" onClick={async () => {
                        if (!window.confirm(`ยกเลิกการจับคู่ “${d.name}”? ส่วนขยายบนเครื่องนั้นจะต้องจับคู่ใหม่`)) return;
                        await api(`/api/extension-devices/${d.id}`, { method: "DELETE" }).catch((e: Error) => setError(e.message));
                        void load();
                      }}>ยกเลิก</Button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
