"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { Button, Card } from "./ui";

type SessionRow = { id: string; createdAt: string; expiresAt: string; current: boolean };
export function AuthSessions({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api<{ sessions: SessionRow[] }>("/api/auth/sessions", { signal });
      if (!signal?.aborted) { setRows(data.sessions); setError(""); }
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : "โหลดเซสชันไม่สำเร็จ"); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void reload(controller.signal); return () => controller.abort(); }, [reload, refreshKey]);
  async function revoke(id: string) {
    setBusy(id);
    try { await api("/api/auth/sessions", { method: "DELETE", body: JSON.stringify({ id }) }); await reload(); }
    catch (error) { setError(error instanceof Error ? error.message : "ออกจากระบบไม่สำเร็จ"); }
    finally { setBusy(null); }
  }
  return <Card>
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">อุปกรณ์ที่เข้าสู่ระบบ</h2><Button variant="outline" disabled={busy !== null} onClick={() => void reload()}>รีเฟรช</Button></div>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    <ul className="mt-3 space-y-3">{rows.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 text-sm">
      <div><p>{row.current ? "เครื่องนี้" : "อุปกรณ์อื่น"}</p><p className="text-xs text-muted">เข้าสู่ระบบ {new Date(row.createdAt).toLocaleString("th-TH")} · หมดอายุ {new Date(row.expiresAt).toLocaleString("th-TH")}</p></div>
      {!row.current ? <Button variant="outline" disabled={busy !== null} onClick={() => void revoke(row.id)}>{busy === row.id ? "กำลังออก…" : "ออกจากระบบอุปกรณ์นี้"}</Button> : null}
    </li>)}</ul>
    <p className="mt-3 text-xs text-muted">แสดงสูงสุด 50 เซสชัน การออกจากระบบอุปกรณ์อื่นมีผลในการตรวจสิทธิ์ครั้งถัดไป ไม่เปลี่ยนการจับคู่ส่วนขยาย</p>
  </Card>;
}
