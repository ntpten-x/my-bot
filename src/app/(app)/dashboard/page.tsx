"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import { INTENT_LABEL, timeAgo } from "@/lib/format";
import type { Lead } from "@/lib/lead";
import { SystemOverviewWidget } from "@/components/system-overview";

type Stats = {
  aiQueue: {
    counts: Record<string, number>;
    oldestPendingMs: number | null;
    processingMs: { count: number; p50: number | null; p95: number | null };
    queueWaitMs: { count: number; p50: number | null; p95: number | null };
    recentSample: number;
    retriedJobs: number;
    terminalSuccessRate: number | null;
    errors: { id: string; status: string; attempts: number; lastError: string; nextAttemptAt: string }[];
    requests: Record<string, { count: number; p50: number | null; p95: number | null }>;
  };
  postsToday: number;
  unread: number;
  buyers: number;
  pipeline: number;
  enabledSources: number;
  errorSources: number;
  byCategory: { id: string | null; name: string; count: number }[];
  recent: Lead[];
  logs: { id: string; status: string; message: string; createdAt: string; sourceName: string }[];
  extension: {
    lastSeen: string | null;
    stale: boolean;
    sources: { id: string; name: string; enabled: boolean; lastExtensionAt: string | null; stale: boolean }[];
  };
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let stopped = false;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const data = await api<Stats>("/api/stats");
        if (!stopped) { setStats(data); setError(""); }
      } catch (err) {
        if (!stopped) setError(err instanceof ApiError ? err.message : "โหลดแดชบอร์ดไม่สำเร็จ");
      } finally { loading = false; }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);

  const cards = stats
    ? [
        ["ลีดวันนี้", stats.postsToday],
        ["ยังไม่อ่าน", stats.unread],
        ["คนกำลังหา", stats.buyers],
        ["อยู่ในไปป์ไลน์", stats.pipeline],
        ["แหล่งที่เปิด", stats.enabledSources],
        ["แหล่งที่มีข้อผิดพลาด", stats.errorSources],
      ]
    : [];
  const max = Math.max(1, ...(stats?.byCategory.map((item) => item.count) ?? [1]));

  return (
    <div>
      <h1 className="text-2xl font-semibold">แดชบอร์ด</h1>
      <p className="mt-1 text-sm text-muted">ภาพรวมลีดที่เก็บจากกลุ่มและบอร์ดที่คุณเฝ้าดู</p>
      <SystemOverviewWidget />
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {!stats && !error ? <p className="mt-6 text-sm text-muted">กำลังโหลด...</p> : null}
      {stats ? (
        <>
          <Card className="mt-6">
            <h2 className="font-semibold">คิวจัดหมวด AI</h2>
            <p className="mt-2 text-sm">
              รอ {stats.aiQueue.counts.pending ?? 0} · กำลังทำ {stats.aiQueue.counts.running ?? 0} · เสร็จ {stats.aiQueue.counts.done ?? 0} · พักหลังผิดซ้ำ {stats.aiQueue.counts.failed ?? 0} · ใช้กฎตามตั้งค่า {stats.aiQueue.counts.skipped ?? 0}
            </p>
            <p className="mt-2 text-sm text-muted">
              งานรอเก่าสุด {stats.aiQueue.oldestPendingMs == null ? "ไม่มี" : `${Math.ceil(stats.aiQueue.oldestPendingMs / 60000)} นาที`}
              {stats.aiQueue.processingMs.count ? ` · เวลาประมวลผล p50 ${stats.aiQueue.processingMs.p50} / p95 ${stats.aiQueue.processingMs.p95} ms (${stats.aiQueue.processingMs.count} งานที่จบล่าสุด)` : " · ยังไม่มีตัวอย่างเวลาประมวลผล"}
            </p>
            {stats.aiQueue.queueWaitMs.count ? <p className="mt-1 text-sm text-muted">เวลาตั้งแต่เข้าคิวถึงเริ่มครั้งล่าสุด p50 {stats.aiQueue.queueWaitMs.p50} / p95 {stats.aiQueue.queueWaitMs.p95} ms รวมเวลารอ retry</p> : null}
            <p className="mt-1 text-sm text-muted">ใน {stats.aiQueue.recentSample} งานที่อัปเดตล่าสุด มีงานเคย retry {stats.aiQueue.retriedJobs} งาน · อัตราสำเร็จเฉพาะงานที่จบ {stats.aiQueue.terminalSuccessRate == null ? "ยังไม่มีข้อมูล" : `${Math.round(stats.aiQueue.terminalSuccessRate * 100)}%`}</p>
            {Object.entries(stats.aiQueue.requests).map(([name, metric]) => <p key={name} className="mt-1 text-sm text-muted">{name === "ingest" ? "รับโพสต์" : "ค้นหา/โหลดฟีด"}: p50 {metric.p50} / p95 {metric.p95} ms ({metric.count} คำขอล่าสุดในโปรเซสนี้ รีเซ็ตเมื่อเปิดแอปใหม่)</p>)}
            <ul className="mt-2 space-y-1 break-words text-sm">
              {stats.aiQueue.errors.map(job => <li key={job.id}>{job.status === "failed" ? "พักงาน" : "รอลองใหม่"} · ลอง {job.attempts} ครั้ง: {job.lastError}{job.status === "pending" ? ` · ครั้งถัดไป ${new Date(job.nextAttemptAt).toLocaleString("th-TH")}` : ""}</li>)}
            </ul>
            <Button className="mt-3" variant="outline" disabled={retrying} onClick={async () => {
              setRetrying(true); setError(""); setMessage("");
              try {
                const result = await api<{ queued: number }>("/api/ai-queue", { method: "POST" });
                setMessage(`ส่ง ${result.queued} โพสต์ที่ยังไม่ได้ผล AI กลับเข้าคิวแล้ว`);
                setStats(await api<Stats>("/api/stats"));
              } catch (err) { setError(err instanceof ApiError ? err.message : "ลองใหม่ไม่สำเร็จ"); }
              finally { setRetrying(false); }
            }}>{retrying ? "กำลังเข้าคิว…" : "ลอง AI ใหม่สำหรับงานที่ยังไม่สำเร็จ"}</Button>
            {message ? <p className="mt-2 text-sm" role="status">{message}</p> : null}
          </Card>
          <Card className={`mt-6 ${stats.extension.stale ? "border-clay" : ""}`}>
            <h2 className="font-semibold">ส่วนขยาย Chrome</h2>
            <p className="mt-2 text-sm">
              ติดต่อล่าสุด {timeAgo(stats.extension.lastSeen)}
              {stats.extension.stale ? " — เงียบเกิน 30 นาที" : ""}
            </p>
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {stats.extension.sources.length ? (
                stats.extension.sources.map((source) => (
                  <li key={source.id}>
                    {source.name}: {source.enabled ? timeAgo(source.lastExtensionAt) : "ปิดอยู่"}
                    {source.stale ? " · ไม่มีข้อมูลเกิน 30 นาที" : ""}
                  </li>
                ))
              ) : (
                <li>ยังไม่ได้เพิ่มกลุ่ม Facebook</li>
              )}
            </ul>
          </Card>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map(([label, value]) => (
              <Card key={String(label)}>
                <div className="text-sm text-muted">{label}</div>
                <div className="mt-2 text-3xl font-semibold">{value}</div>
              </Card>
            ))}
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="font-semibold">ตามหมวด</h2>
              <div className="mt-4 space-y-3">
                {stats.byCategory.length ? (
                  stats.byCategory.map((item) => (
                    <div key={item.name}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{item.name}</span>
                        <span>{item.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-paper">
                        <div className="h-2 rounded-full bg-clay" style={{ width: `${(item.count / max) * 100}%` }} />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted">ยังไม่มีประกาศให้จัดหมวด</p>
                )}
              </div>
            </Card>
            <Card>
              <h2 className="font-semibold">ลีดล่าสุด</h2>
              <div className="mt-3 space-y-3">
                {stats.recent.length ? (
                  stats.recent.map((lead) => (
                    <Link key={lead.id} href="/feed" className="block rounded-xl bg-paper px-3 py-2">
                      <div className="text-xs text-muted">
                        {INTENT_LABEL[lead.intent]} · {lead.province || "ไม่ระบุจังหวัด"} · {timeAgo(lead.createdAt)}
                      </div>
                      <div className="mt-1 line-clamp-2 text-sm">{lead.text}</div>
                    </Link>
                  ))
                ) : (
                  <p className="text-sm text-muted">
                    ยังไม่มีลีด เพิ่มกลุ่มในหน้าแหล่งข้อมูล แล้วเปิดส่วนขยาย Chrome
                  </p>
                )}
              </div>
            </Card>
          </div>
          <Card className="mt-4">
            <h2 className="font-semibold">บันทึกการดึงล่าสุด</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {stats.logs.length ? (
                stats.logs.map((log) => (
                  <li key={log.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-2">
                    <span>
                      {log.sourceName}: {log.message || log.status}
                    </span>
                    <span className="text-muted">{timeAgo(log.createdAt)}</span>
                  </li>
                ))
              ) : (
                <li className="text-muted">ยังไม่มีการดึงข้อมูล</li>
              )}
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}
