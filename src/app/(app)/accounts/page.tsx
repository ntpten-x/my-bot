"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/components/api";
import { Badge, Button, Card, Input, Label, Select } from "@/components/ui";
import { timeAgo } from "@/lib/format";

type Account = { id: string; name: string; browser: string; profileLabel: string; enabled: boolean; connected: boolean; localEnabled: boolean; status: string; postsCaptured: number; lastSeenAt: string; devices: { id: string; browser: string; profileLabel: string; lastSeenAt: string; connected: boolean; localEnabled: boolean; version: string; currentVersion: boolean }[] };
const STATUS: Record<string, string> = { ready: "พร้อมรับงาน", paused: "หยุดงานจากระบบ", offline: "รอเชื่อมต่อ", local_paused: "พักงานที่ส่วนขยาย", upgrade_required: "ต้องอัปเดตส่วนขยาย" };

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const requestId = useRef({ value: 0 });
  const load = useCallback(async () => {
    const id = ++requestId.current.value;
    try {
      const data = await api<{ accounts: Account[]; checkedAt: string }>("/api/facebook-accounts");
      if (id !== requestId.current.value) return;
      setAccounts(data.accounts); setCheckedAt(data.checkedAt); setError("");
    } catch (err) { if (id === requestId.current.value) setError(err instanceof Error ? err.message : "โหลดบัญชีไม่สำเร็จ"); }
    finally { if (id === requestId.current.value) setLoading(false); }
  }, []);
  useEffect(() => { const sequence = requestId.current; void load(); const timer = setInterval(() => void load(), 15000); return () => { clearInterval(timer); sequence.value++; }; }, [load]);
  async function toggle(account: Account) {
    setBusy(account.id); setError(""); setInfo(""); requestId.current.value++;
    try {
      await api(`/api/facebook-accounts/${account.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !account.enabled }) });
      setInfo(account.enabled ? `หยุดงานบัญชี ${account.name || account.id} แล้ว ส่วนขยายรับสถานะภายในประมาณ 1 นาที` : `เปิดทำงานบัญชี ${account.name || account.id} แล้ว ระบบจะรับงานได้เมื่อเชื่อมต่อและส่วนขยายเปิดทำงาน`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "เปลี่ยนสถานะไม่สำเร็จ"); }
    finally { setBusy(""); }
  }
  const shown = accounts.filter(row => (!filter || (filter === "online" ? row.connected : filter === "offline" ? !row.connected : !row.enabled)) && `${row.name} ${row.id} ${row.profileLabel}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">จัดการบัญชี</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-muted">บัญชี Facebook ที่ส่วนขยายเคยเชื่อมต่อ เปิดหรือหยุดงานแยกแต่ละบัญชีได้ แม้ใช้หลายเบราว์เซอร์</p></div><Button variant="outline" disabled={Boolean(busy)} onClick={() => void load()}>รีเฟรชสถานะ</Button></div>
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-line py-3 text-sm"><span>ทั้งหมด <b>{accounts.length}</b> บัญชี</span><span className="text-pine">ออนไลน์ <b>{accounts.filter(row => row.connected).length}</b></span><span className="text-muted">ออฟไลน์ <b>{accounts.filter(row => !row.connected).length}</b></span><span>หยุดงาน <b>{accounts.filter(row => !row.enabled).length}</b></span></div>
    {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}{info ? <p role="status" className="rounded-lg bg-pine/10 p-3 text-sm text-pine">{info}</p> : null}
    <div className="grid gap-3 sm:grid-cols-[1fr_220px]"><div><Label htmlFor="account-search">ค้นหาบัญชี</Label><Input id="account-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ชื่อบัญชี รหัส Facebook หรือชื่อโปรไฟล์" /></div><div><Label htmlFor="account-filter">แสดงสถานะ</Label><Select id="account-filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="">ทุกบัญชี</option><option value="online">ออนไลน์</option><option value="offline">ออฟไลน์</option><option value="paused">หยุดงาน</option></Select></div></div>
    {loading ? <p role="status" className="py-8 text-sm text-muted">กำลังตรวจบัญชี...</p> : !shown.length ? <Card><h2 className="font-semibold">{accounts.length ? "ไม่พบบัญชีตามตัวกรอง" : "ยังไม่มีบัญชี Facebook เชื่อมต่อ"}</h2><p className="mt-2 text-sm leading-6 text-muted">{accounts.length ? "ลองเปลี่ยนคำค้นหรือสถานะที่เลือก" : "จับคู่ส่วนขยาย Chrome ในหน้าตั้งค่า แล้วล็อกอิน Facebook บนโปรไฟล์ Chrome นั้น บัญชีจะปรากฏเมื่อส่วนขยายส่งสถานะเข้ามา"}</p><Link href="/settings/extension" className="mt-3 inline-block text-sm text-pine underline">ตั้งค่าการเชื่อมต่อส่วนขยาย</Link></Card> : <div className="space-y-3">{shown.map(account => <Card key={account.id}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-lg font-semibold">{account.name || `บัญชี Facebook ${account.id}`}</h2><Badge tone={account.connected ? "pine" : "neutral"}>{account.connected ? "ออนไลน์ · เชื่อมต่ออยู่" : "ออฟไลน์ · ไม่พบการเชื่อมต่อ"}</Badge></div><p className="mt-1 text-xs text-muted">Facebook ID: {account.id}</p><p className="mt-3 text-sm"><span className="font-medium">{STATUS[account.status] ?? account.status}</span> · เก็บแล้ว {account.postsCaptured.toLocaleString()} โพสต์</p><p className="mt-1 text-xs text-muted">พบล่าสุด {timeAgo(account.lastSeenAt)}{account.profileLabel ? ` · ${account.profileLabel}` : ""}</p></div><Button variant={account.enabled ? "outline" : "pine"} disabled={Boolean(busy)} aria-label={`${account.enabled ? "หยุดทำงาน" : "เปิดทำงาน"} ${account.name || account.id}`} onClick={() => void toggle(account)}>{busy === account.id ? "กำลังบันทึก..." : account.enabled ? "หยุดทำงาน" : "เปิดทำงาน"}</Button></div>
      <div className="mt-4 border-t border-line pt-3"><p className="text-xs font-medium">การเชื่อมต่อจากส่วนขยาย</p>{account.devices.length ? <ul className="mt-2 space-y-2">{account.devices.map(device => <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{device.profileLabel || device.browser || "Chrome"} · v{device.version || "ไม่ทราบ"}</span><span className={device.connected ? "text-pine" : "text-muted"}>{device.connected ? device.localEnabled ? "เชื่อมต่อ · เปิดที่ส่วนขยาย" : "เชื่อมต่อ · พักที่ส่วนขยาย" : `ไม่เชื่อมต่อ · ${timeAgo(device.lastSeenAt)}`}</span></li>)}</ul> : <p className="mt-2 text-xs text-muted">ไม่พบส่วนขยายที่เชื่อมต่ออยู่ เปิด Chrome และตรวจการจับคู่</p>}</div>
    </Card>)}</div>}
    <div className="space-y-2 text-xs leading-5 text-muted"><p>ออนไลน์หมายถึงส่วนขยายรายงานว่าเข้าสู่ Facebook และติดต่อระบบภายใน 3 นาทีล่าสุด ไม่ใช่สถานะ Active บน Facebook หน้านี้รีเฟรชอัตโนมัติทุก 15 วินาที{checkedAt ? ` · ตรวจล่าสุด ${new Date(checkedAt).toLocaleTimeString("th-TH")}` : ""}</p><p>หยุดงานจะระงับงานอ่านใหม่ การรับโพสต์ และการอนุญาตคอมเมนต์ใหม่ของบัญชีนี้ทุกอุปกรณ์ ยังรับสถานะและรายงานผลงานเดิมได้ คิวโพสต์ค้างจะเก็บไว้รอเปิดงานอีกครั้ง การอ่านที่เริ่มไปแล้วอาจใช้เวลาหยุด และสิทธิ์กดส่งที่ออกไปแล้วอาจทำงานต่อได้ถึง 3 วินาที</p><p>เปิดงานไม่ล็อกอิน Facebook ให้ และไม่เปิดการส่งคอมเมนต์เอง หากพักที่ส่วนขยาย ต้องเปิดจากส่วนขยายด้วย</p></div>
  </div>;
}
