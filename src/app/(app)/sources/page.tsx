"use client";

import { FormEvent, useEffect, useState } from "react";
import { Badge, Button, Card, Input, Select, Textarea } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import { timeAgo, timeUntil } from "@/lib/format";
import { PRIORITY_INTERVAL, PRIORITY_LABEL, isExtensionSource, type SourcePriority } from "@/lib/scrape-plan";
import type { CategoryRow, SourceRow } from "@/lib/lead";
import { SourceBinding, type Binding } from "@/components/source-binding";
import type { ProductRow } from "@/components/products-editor";

const STOP_LABEL: Record<string, string> = {
  seen: "เจอโพสต์ที่เก็บแล้ว",
  old: "เจอโพสต์เก่าเกินกำหนด",
  cap: "ครบจำนวนต่อรอบ",
  end: "ไม่มีโพสต์เพิ่ม",
  screens: "เลื่อนครบตามที่ตั้ง",
  limit: "เลื่อนครบขีดจำกัดรอบนี้",
  error: "ผิดพลาด",
};

function IntervalInput({ value, onSave }: { value: number; onSave: (minutes: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <Input
      type="number"
      min={2}
      max={180}
      value={draft}
      className="w-20"
      aria-label="ทุกกี่นาที"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const minutes = Math.round(Number(draft));
        if (Number.isFinite(minutes) && minutes >= 2 && minutes <= 180 && minutes !== value) onSave(minutes);
        else setDraft(String(value));
      }}
    />
  );
}

const TYPE_LABEL: Record<string, string> = {
  facebook_group: "กลุ่ม Facebook",
  facebook_marketplace: "Marketplace",
  rss: "RSS",
  web_board: "เว็บบอร์ด",
};

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [urls, setUrls] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("auto");
  const [priority, setPriority] = useState<SourcePriority>("normal");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(true);
  const [bindings, setBindings] = useState<Map<string, Binding>>(new Map());
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ sources: SourceRow[] }>("/api/sources");
      setSources(data.sources);
      setError("");
      // Bindings are extra; a failure must not hide the sources list.
      Promise.all([
        api<{ bindings: Binding[] }>("/api/sources/bindings"),
        api<{ categories: CategoryRow[] }>("/api/categories"),
        api<{ products: ProductRow[] }>("/api/products"),
      ])
        .then(([b, c, p]) => {
          setBindings(new Map(b.bindings.map((item) => [item.sourceId, item])));
          setCategories(c.categories);
          setProducts(p.products);
        })
        .catch(() => undefined);
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
        body: JSON.stringify({ urls, name, type, priority }),
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
        วางลิงก์กลุ่ม Facebook ที่คุณเป็นสมาชิกอยู่แล้ว หรือหน้าค้นหา/หมวดของ Facebook Marketplace (เช่น facebook.com/marketplace/bangkok/search?query=แอร์) ได้ทีละหลายบรรทัด กลุ่มและ Marketplace ให้ส่วนขยายอ่านจากเบราว์เซอร์ที่ล็อกอิน (อ่านอย่างเดียว ไม่กดอะไรบน Facebook) ส่วน RSS และเว็บบอร์ดให้โปรแกรมหลังบ้านดึงเอง ประกาศจาก Marketplace จะถูกจัดเป็น “ขาย” เสมอ
      </p>
      <Card className="mt-5">
        <form onSubmit={add} className="space-y-3">
          <Textarea
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
            placeholder={"https://www.facebook.com/groups/123456\nhttps://www.facebook.com/marketplace/bangkok/search?query=แอร์\nhttps://example.com/feed.xml"}
          />
          <div className="grid gap-3 md:grid-cols-[1fr_180px_150px_auto]">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="ชื่อแหล่ง (ใช้เมื่อวางลิงก์เดียว)" />
            <Select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="auto">ตรวจชนิดอัตโนมัติ</option>
              <option value="facebook_group">กลุ่ม Facebook</option>
              <option value="facebook_marketplace">Facebook Marketplace</option>
              <option value="rss">RSS</option>
              <option value="web_board">เว็บบอร์ด</option>
            </Select>
            <Select value={priority} onChange={(event) => setPriority(event.target.value as SourcePriority)} aria-label="ความสำคัญ">
              {(["high", "normal", "low"] as SourcePriority[]).map((value) => (
                <option key={value} value={value}>ความสำคัญ{PRIORITY_LABEL[value]} ({PRIORITY_INTERVAL[value]} นาที)</option>
              ))}
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
                  {isExtensionSource(source.type) ? <Badge tone={source.priority === "high" ? "pine" : "neutral"}>สำคัญ{PRIORITY_LABEL[source.priority]}</Badge> : null}
                  {source.coverage && source.enabled ? (
                    <span
                      title={source.coverage.reasons.join("\n") || "รอบล่าสุดเลื่อนจนเจอโพสต์ที่เก็บแล้ว"}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${source.coverage.level === "ok" ? "bg-emerald-100 text-emerald-800" : source.coverage.level === "warn" ? "bg-amber-100 text-amber-800" : source.coverage.level === "bad" ? "bg-red-100 text-red-800" : "bg-stone-100 text-stone-600"}`}
                    >
                      ความครบ: {source.coverage.label}
                      {source.coverage.reachedKnownPct !== null ? ` · ${source.coverage.reachedKnownPct}% ถึงโพสต์เดิม` : ""}
                    </span>
                  ) : null}
                </div>
                <a href={source.url} className="mt-1 block break-all text-sm text-clay" target="_blank" rel="noreferrer">{source.url}</a>
                <p className="mt-2 text-sm text-muted">
                  {source.postCount} โพสต์ · ดึงล่าสุด {timeAgo(source.lastFetchedAt)}
                  {isExtensionSource(source.type) ? null : ` · ทุก ${source.intervalMinutes} นาที`}
                </p>
                {isExtensionSource(source.type) ? (
                  <div className="mt-2 grid gap-x-4 gap-y-1 text-sm text-muted sm:grid-cols-2 lg:grid-cols-4">
                    <span>รอบล่าสุด: {source.lastRunAt ? timeAgo(source.lastRunAt) : "ยังไม่เคย"}</span>
                    <span>
                      เจอใหม่: <b className="text-ink">{source.lastRunNew}</b>
                      {source.lastRunAt ? ` จาก ${source.lastRunFound} · เลื่อน ${source.lastRunScrolls} จอ` : ""}
                    </span>
                    <span>รอบถัดไป: {source.enabled ? timeUntil(source.nextRunAt) : "ปิดอยู่"}</span>
                    <span>
                      รอบตอนนี้: ทุก {Math.round(source.currentIntervalMinutes * 10) / 10} นาที (ตั้งไว้ {source.intervalMinutes}, ไม่เกิน {source.maxIntervalMinutes})
                    </span>
                    {source.lastRunStop ? <span className="sm:col-span-2 lg:col-span-4">หยุดรอบล่าสุดเพราะ{STOP_LABEL[source.lastRunStop] ?? source.lastRunStop}</span> : null}
                  </div>
                ) : null}
                {source.coverage && source.enabled && source.coverage.reasons.length ? (
                  <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
                    {source.coverage.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
                {bindings.get(source.id) ? (
                  <SourceBinding binding={bindings.get(source.id)!} categories={categories} products={products} onSave={(body) => void patch(source.id, body)} />
                ) : null}
                {source.lastError ? <p className="mt-1 text-sm text-red-700">สาเหตุที่ดึงไม่สำเร็จ: {source.lastError}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isExtensionSource(source.type) ? (
                  <>
                    <Select
                      value={source.priority}
                      aria-label="ความสำคัญ"
                      className="w-auto"
                      onChange={(event) => void patch(source.id, { priority: event.target.value })}
                    >
                      {(["high", "normal", "low"] as SourcePriority[]).map((value) => (
                        <option key={value} value={value}>สำคัญ{PRIORITY_LABEL[value]}</option>
                      ))}
                    </Select>
                    <span className="text-sm text-muted">ทุก</span>
                    <IntervalInput value={source.intervalMinutes} onSave={(minutes) => void patch(source.id, { intervalMinutes: minutes })} />
                    <span className="text-sm text-muted">นาที</span>
                  </>
                ) : null}
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
                {isExtensionSource(source.type) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    title="ให้ส่วนขยายเลื่อนลึกย้อนหลัง 72 ชม. (อ่านอย่างเดียว) แล้วนับโพสต์ที่ระบบยังไม่มี"
                    onClick={async () => {
                      setInfo("");
                      setError("");
                      try {
                        const data = await api<{ message: string }>(`/api/sources/${source.id}/audit`, { method: "POST" });
                        setInfo(data.message);
                        await load();
                      } catch (err) {
                        setError(err instanceof ApiError ? err.message : "สั่งตรวจไม่สำเร็จ");
                      }
                    }}
                  >
                    ตรวจความครบ
                  </Button>
                ) : null}
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
