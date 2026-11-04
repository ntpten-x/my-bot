"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Input, Label, Textarea } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import { assistReply, cancelAdvance, extensionSupportsAdvance, requestAdvance, type AssistTemplate } from "@/components/assist-reply";
import { SHORTCUT_HELP, shortcutFor } from "@/lib/reply-shortcuts";

type QueueSettings = {
  enabled: boolean;
  times: string;
  dailyCap: number;
  gapMinMinutes: number;
  gapMaxMinutes: number;
  authorDays: number;
  groupDailyCap: number;
  minScore: number;
  autoAdvance: boolean;
  autoMarkSent: boolean;
  autoInsert: boolean;
};
type AdvanceInfo = { decision: "ready" | "wait" | "open" | "cap" | "empty"; waitMs: number; reason: string };
type Countdown = { at: number; via: "extension" | "panel" };
type QueueItem = {
  id: string;
  postId: string;
  status: "queued" | "opened" | "sent" | "skipped";
  text: string;
  day: string;
  openedAt: string | null;
  url: string;
  authorName: string;
  source: string;
  score: number;
  province: string | null;
  snippet: string;
};
type QueueState = { settings: QueueSettings; items: QueueItem[]; openedToday: number; cap: number; nextAllowedAt: string | null };

const STATUS: Record<QueueItem["status"], string> = { queued: "รอเปิด", opened: "เปิดแล้ว รอคุณกดส่ง", sent: "ตอบแล้ว", skipped: "ข้าม" };

function clockTh(iso: string) {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function ReplyQueuePanel() {
  const [state, setState] = useState<QueueState | null>(null);
  const [form, setForm] = useState<QueueSettings | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [countdown, setCountdown] = useState<Countdown | null>(null);
  const [readyToOpen, setReadyToOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const nextButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const data = await api<QueueState>("/api/reply-queue");
    setState(data);
    setForm((current) => current ?? data.settings);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof ApiError ? err.message : "โหลดคิวไม่สำเร็จ"));
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    // Pick up "sent/skip" marked from the Facebook tab and items opened by auto-advance.
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => undefined);
    }, 15000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(poll);
    };
  }, [load]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ทำรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const waitMs = state?.nextAllowedAt ? Math.max(0, new Date(state.nextAllowedAt).getTime() - now) : 0;
  const openItem = state?.items.find((item) => item.status === "opened");
  const nextItem = state?.items.find((item) => item.status === "queued");
  const capReached = state ? state.openedToday >= state.cap : false;
  const prefs = state?.settings;
  const countdownMs = countdown ? Math.max(0, countdown.at - now) : 0;

  // Countdown finished. With the extension (1.2+) it opens the next post itself; without it the browser
  // blocks tabs opened by timers, so the panel just highlights "เปิดรายการถัดไป" (or press N).
  useEffect(() => {
    if (!countdown || countdownMs > 0) return;
    setCountdown(null);
    if (countdown.via === "panel") {
      setReadyToOpen(true);
      setNote("ถึงเวลาเปิดรายการถัดไปแล้ว — กด N หรือปุ่ม “เปิดรายการถัดไป”");
      nextButton.current?.focus();
    }
    window.setTimeout(() => void load().catch(() => undefined), countdown.via === "extension" ? 6000 : 0);
  }, [countdown, countdownMs, load]);

  async function openNext() {
    if (!nextItem) return;
    await run(async () => {
      setReadyToOpen(false);
      setCountdown(null);
      const { item, prefs: itemPrefs } = await api<{
        item: { id: string; postId: string; url: string; text: string; templates?: AssistTemplate[] };
        prefs?: { autoMarkSent?: boolean; autoInsert?: boolean };
      }>(`/api/reply-queue/${nextItem.id}/open`, { method: "POST" });
      const result = await assistReply(item.url, item.text, { itemId: item.id, postId: item.postId, templates: item.templates, prefs: itemPrefs });
      setNote(result.opened ? result.message : `${result.message} (เบราว์เซอร์บล็อกแท็บใหม่ — กด “เปิดโพสต์อีกครั้ง”)`);
      await load();
    });
  }

  async function finish(id: string, action: "sent" | "skip") {
    await run(async () => {
      const text = editingId === id && editText.trim() ? editText : undefined;
      const data = await api<{ advance?: AdvanceInfo }>(`/api/reply-queue/${id}`, { method: "POST", body: JSON.stringify({ action, text }) });
      if (editingId === id) setEditingId(null);
      const done = action === "sent" ? "บันทึกว่าตอบแล้ว" : "ข้ามรายการนี้แล้ว";
      setNote(done);
      await load();
      await planAdvance(data.advance, done);
    });
  }

  // After "sent/skip": open the next lead automatically once the gap and daily cap allow.
  async function planAdvance(advance: AdvanceInfo | undefined, done: string) {
    if (!advance || !prefs?.autoAdvance) return;
    if (advance.decision !== "ready" && advance.decision !== "wait") {
      if (advance.decision !== "open" && advance.reason) setNote(`${done} · ${advance.reason}`);
      return;
    }
    if (extensionSupportsAdvance()) {
      const reply = await requestAdvance();
      if (reply.ok && reply.at) {
        setCountdown({ at: reply.at, via: "extension" });
        return;
      }
      if (reply.ok && reply.reason) {
        setNote(`${done} · ${reply.reason}`);
        return;
      }
    }
    setCountdown({ at: Date.now() + Math.max(0, advance.waitMs), via: "panel" });
  }

  async function stopCountdown() {
    if (countdown?.via === "extension") await cancelAdvance();
    setCountdown(null);
    setNote("ยกเลิกการเปิดรายการถัดไปอัตโนมัติแล้ว");
  }

  async function reopen(item: QueueItem) {
    const result = await assistReply(item.url, item.text, { itemId: item.id, postId: item.postId, prefs: { autoMarkSent: prefs?.autoMarkSent, autoInsert: prefs?.autoInsert } });
    setNote(result.message);
  }

  function startEdit(item: QueueItem) {
    setEditingId(item.id);
    setEditText(item.text);
  }

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text) return;
    await run(async () => {
      await api(`/api/reply-queue/${id}`, { method: "POST", body: JSON.stringify({ action: "edit", text: editText }) });
      setEditingId(null);
      setNote("บันทึกข้อความแล้ว");
      await load();
    });
  }

  // Keyboard shortcuts: N open next · S sent · K skip · E edit (ignored while typing in a field).
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const action = shortcutFor({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      repeat: event.repeat,
      targetTag: target?.tagName,
      targetEditable: Boolean(target?.isContentEditable),
    });
    if (!action || busy || !state) return;
    const current = openItem ?? nextItem;
    if (action === "next") {
      if (!nextItem || waitMs > 0 || capReached || openItem) return;
      event.preventDefault();
      void openNext();
    } else if (action === "sent") {
      if (!openItem) return;
      event.preventDefault();
      void finish(openItem.id, "sent");
    } else if (action === "skip") {
      if (!current) return;
      event.preventDefault();
      void finish(current.id, "skip");
    } else if (action === "edit") {
      if (!current) return;
      event.preventDefault();
      startEdit(current);
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  async function save() {
    if (!form) return;
    await run(async () => {
      const data = await api<{ settings: QueueSettings }>("/api/reply-queue", { method: "PUT", body: JSON.stringify(form) });
      setForm(data.settings);
      setNote("บันทึกการตั้งค่าคิวแล้ว");
      await load();
    });
  }

  async function buildNow() {
    await run(async () => {
      const data = await api<{ created: number; reason: string }>("/api/reply-queue/build", { method: "POST" });
      setNote(data.created ? `เพิ่มเข้าคิว ${data.created} รายการ` : data.reason || "ไม่มีรายการใหม่");
      await load();
    });
  }

  function field(key: keyof QueueSettings, label: string, min: number, max: number) {
    if (!form) return null;
    return (
      <label className="flex items-center justify-between gap-2 text-sm">
        <span>{label}</span>
        <Input
          type="number"
          min={min}
          max={max}
          className="h-8 w-20"
          value={String(form[key])}
          onChange={(event) => setForm({ ...form, [key]: Number(event.target.value) })}
        />
      </label>
    );
  }

  return (
    <Card id="reply-queue" className="mt-4 space-y-3">
      <div>
        <h2 className="font-semibold">คิวตอบลีด (คุณกดส่งเอง)</h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          ถึงเวลาที่ตั้งไว้ ระบบจะคัดลีดที่ตรงเงื่อนไข เติมข้อความจากข้อความสำเร็จรูป (สลับกันใช้) แล้วแจ้งเข้า Discord/LINE
          คุณกด “เปิดรายการถัดไป” ระบบจะเปิดโพสต์พร้อมกล่อง MY-BOT ให้แก้/สลับข้อความและใส่ลงช่องคอมเมนต์ — คุณกดส่งใน Facebook เอง
          แล้วกด “ส่งแล้ว” (ที่นี่หรือในกล่องบนโพสต์) ระบบจะเปิดรายการถัดไปให้เมื่อครบเวลาเว้นระยะ — ไม่กดส่ง ไม่ส่งข้อความ และไม่คอมเมนต์แทนคุณ
        </p>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {note ? <p className="text-sm text-pine" role="status">{note}</p> : null}

      {form ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-xl bg-paper p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
              สร้างคิวอัตโนมัติตามเวลา
            </label>
            <div className="space-y-1">
              <Label>เวลาสร้างคิว (เวลาไทย คั่นด้วยจุลภาค)</Label>
              <Input value={form.times} onChange={(event) => setForm({ ...form, times: event.target.value })} placeholder="09:00, 18:00" />
            </div>
            {field("dailyCap", "ตอบได้สูงสุดต่อวัน", 1, 100)}
            {field("minScore", "คะแนนลีดขั้นต่ำ", 0, 100)}
          </div>
          <div className="space-y-2 rounded-xl bg-paper p-3">
            {field("gapMinMinutes", "เว้นระยะระหว่างการตอบ ต่ำสุด (นาที)", 0, 120)}
            {field("gapMaxMinutes", "เว้นระยะ สูงสุด (นาที, สุ่มระหว่างนี้)", 0, 180)}
            {field("authorDays", "ไม่ตอบคนเดิมซ้ำภายใน (วัน)", 0, 90)}
            {field("groupDailyCap", "ตอบได้สูงสุดต่อกลุ่มต่อวัน", 1, 50)}
            <p className="text-xs text-muted">โพสต์เดียวกันจะไม่เข้าคิวซ้ำเด็ดขาด</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.autoAdvance} onChange={(event) => setForm({ ...form, autoAdvance: event.target.checked })} />
              กด “ส่งแล้ว/ข้าม” แล้วเปิดรายการถัดไปอัตโนมัติ (เมื่อครบเวลาเว้นระยะ)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.autoInsert} onChange={(event) => setForm({ ...form, autoInsert: event.target.checked })} />
              ใส่ข้อความลงช่องคอมเมนต์ทันทีที่เปิดโพสต์ (ไม่ต้องกดในกล่อง MY-BOT)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.autoMarkSent} onChange={(event) => setForm({ ...form, autoMarkSent: event.target.checked })} />
              เห็นคอมเมนต์ของคุณขึ้นแล้ว ให้บันทึก “ส่งแล้ว” เอง
            </label>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void save()} disabled={busy || !form}>บันทึกการตั้งค่า</Button>
        <Button size="sm" variant="outline" onClick={() => void buildNow()} disabled={busy}>สร้างคิวตอนนี้</Button>
      </div>

      {state ? (
        <div className="space-y-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>เปิดไปแล้ววันนี้ {state.openedToday}/{state.cap}</span>
            <Button
              size="sm"
              variant="pine"
              ref={nextButton}
              className={readyToOpen ? "ring-2 ring-clay" : undefined}
              onClick={() => void openNext()}
              disabled={busy || !nextItem || waitMs > 0 || capReached || Boolean(openItem)}
            >
              เปิดรายการถัดไป
            </Button>
            {waitMs > 0 ? (
              <span className="text-xs text-muted">
                รออีก {Math.floor(waitMs / 60000)}:{String(Math.floor((waitMs % 60000) / 1000)).padStart(2, "0")} นาที (ถึง {clockTh(state.nextAllowedAt!)} เวลาไทย)
              </span>
            ) : null}
            {openItem ? <span className="text-xs text-clay">กด “ส่งแล้ว” หรือ “ข้าม” รายการที่เปิดอยู่ก่อน</span> : null}
            {capReached ? <span className="text-xs text-clay">ครบโควตาวันนี้แล้ว</span> : null}
          </div>
          {countdown ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-pine/10 px-3 py-2 text-sm" role="status">
              <span>
                จะเปิดรายการถัดไปอัตโนมัติใน {Math.floor(countdownMs / 60000)}:{String(Math.floor((countdownMs % 60000) / 1000)).padStart(2, "0")}
                {countdown.via === "panel" ? " (ไม่มีส่วนขยาย 1.2 — ถึงเวลาแล้วกด N)" : ""}
              </span>
              <Button size="sm" variant="outline" onClick={() => void stopCountdown()}>ยกเลิก</Button>
            </div>
          ) : null}
          <p className="text-xs text-muted">{SHORTCUT_HELP} · ในแท็บ Facebook: Alt+Shift+S ส่งแล้ว · Alt+Shift+K ข้าม</p>
          {state.items.length ? (
            state.items.map((item) => (
              <div key={item.id} className={`rounded-xl border p-3 text-sm ${item.status === "opened" ? "border-clay/50 bg-clay/5" : "border-line"}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-medium text-ink">{item.authorName || "ไม่ทราบชื่อ"}</span>
                  <span>{item.source}</span>
                  <span>คะแนน {item.score}</span>
                  {item.province ? <span>{item.province}</span> : null}
                  <span className="ml-auto">{STATUS[item.status]}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{item.snippet}</p>
                {editingId === item.id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      autoFocus
                      rows={4}
                      maxLength={2000}
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setEditingId(null);
                      }}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="pine" onClick={() => void saveEdit(item.id)} disabled={busy || !editText.trim()}>บันทึกข้อความ</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>ยกเลิก (Esc)</Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap rounded-lg bg-paper px-2 py-1">{item.text}</p>
                )}
                {item.status === "opened" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="pine" onClick={() => void finish(item.id, "sent")} disabled={busy}>ส่งแล้ว</Button>
                    <Button size="sm" variant="outline" onClick={() => void reopen(item)} disabled={busy}>เปิดโพสต์อีกครั้ง</Button>
                    <Button size="sm" variant="outline" onClick={() => void finish(item.id, "skip")} disabled={busy}>ข้าม</Button>
                    {editingId !== item.id ? <Button size="sm" variant="outline" onClick={() => startEdit(item)} disabled={busy}>แก้ข้อความ</Button> : null}
                  </div>
                ) : item.status === "queued" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void finish(item.id, "skip")} disabled={busy}>ข้าม</Button>
                    {editingId !== item.id ? <Button size="sm" variant="outline" onClick={() => startEdit(item)} disabled={busy}>แก้ข้อความ</Button> : null}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-xs text-muted">ยังไม่มีรายการในคิววันนี้</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
