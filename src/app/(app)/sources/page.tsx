"use client";

import { FormEvent, useEffect, useState } from "react";
import { Badge, Button, Card, Input, Select, Textarea } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import { timeAgo } from "@/lib/format";
import type { SourceRow } from "@/lib/lead";

const TYPE_LABEL: Record<string, string> = {
  facebook_group: "กลุ่ม Facebook",
  rss: "RSS",
  web_board: "เว็บบอร์ด",
};

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [urls, setUrls] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("auto");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ sources: SourceRow[] }>("/api/sources");
      setSources(data.sources);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "โหลดแหล่งข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    setInfo("");
    setError("");
    try {
      const data = await api<{ created: number; skipped: string[] }>("/api/sources", {
        method: "POST",
        body: JSON.stringify({ urls, name, type }),
      });
      setInfo(`เพิ่มแล้ว ${data.created} แหล่ง${data.skipped.length ? ` ข้าม ${data.skipped.length} ลิงก์` : ""}`);
      setUrls("");
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เพิ่มไม่สำเร็จ");
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await api(`/api/sources/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    await load();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">แหล่งข้อมูล</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
        วางลิงก์กลุ่ม Facebook ที่คุณเป็นสมาชิกอยู่แล้ว ได้ทีละหลายบรรทัด กลุ่ม Facebook ให้ส่วนขยายเป็นคนอ่านจากเบราว์เซอร์ที่ล็อกอิน ส่วน RSS และเว็บบอร์ดให้โปรแกรมหลังบ้านดึงเอง
      </p>
      <Card className="mt-5">
        <form onSubmit={add} className="space-y-3">
          <Textarea
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
            placeholder={"https://www.facebook.com/groups/123456\nhttps://example.com/feed.xml"}
          />
          <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="ชื่อแหล่ง (ใช้เมื่อวางลิงก์เดียว)" />
            <Select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="auto">ตรวจชนิดอัตโนมัติ</option>
              <option value="facebook_group">กลุ่ม Facebook</option>
              <option value="rss">RSS</option>
              <option value="web_board">เว็บบอร์ด</option>
            </Select>
            <Button type="submit">เพิ่มแหล่ง</Button>
          </div>
        </form>
        {info ? <p className="mt-3 text-sm text-pine">{info}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      </Card>
      {loading ? <p className="mt-6 text-sm text-muted">กำลังโหลด...</p> : null}
      <div className="mt-4 space-y-3">
        {sources.map((source) => (
          <Card key={source.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{source.name}</h2>
                  <Badge>{TYPE_LABEL[source.type] ?? source.type}</Badge>
                  <Badge tone={source.enabled ? "pine" : "neutral"}>{source.enabled ? "เปิด" : "ปิด"}</Badge>
                </div>
                <a href={source.url} className="mt-1 block break-all text-sm text-clay" target="_blank" rel="noreferrer">{source.url}</a>
                <p className="mt-2 text-sm text-muted">
                  {source.postCount} โพสต์ · ดึงล่าสุด {timeAgo(source.lastFetchedAt)} · ส่วนขยาย {timeAgo(source.lastExtensionAt)} · ทุก {source.intervalMinutes} นาที
                </p>
                {source.lastError ? <p className="mt-1 text-sm text-red-700">สาเหตุที่ดึงไม่สำเร็จ: {source.lastError}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    setInfo("");
                    setError("");
                    try {
                      const data = await api<{ message: string }>(`/api/sources/${source.id}/fetch-now`, { method: "POST" });
                      setInfo(data.message);
                      await load();
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : "สั่งดึงไม่สำเร็จ");
                    }
                  }}
                >
                  ดึงทันที
                </Button>
                <Button size="sm" variant="outline" onClick={() => patch(source.id, { enabled: !source.enabled })}>
                  {source.enabled ? "ปิดชั่วคราว" : "เปิดใช้"}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (confirm(`ลบ ${source.name} และโพสต์ของแหล่งนี้?`)) {
                      void api(`/api/sources/${source.id}`, { method: "DELETE" }).then(load);
                    }
                  }}
                >
                  ลบ
                </Button>
              </div>
            </div>
            {source.logs.length ? (
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {source.logs.map((log) => (
                  <li key={log.id} className={log.status === "error" ? "text-red-700" : undefined}>
                    {timeAgo(log.createdAt)} · {log.status === "error" ? "ผิดพลาด" : log.status} · {log.message || "ไม่ทราบสาเหตุ"}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
