"use client";

import { useState } from "react";
import { Badge, Button, Textarea } from "@/components/ui";
import { Highlight } from "@/components/highlight";
import { api } from "@/components/api";
import { INTENT_LABEL, PIPELINE, timeAgo } from "@/lib/format";
import type { Lead } from "@/lib/lead";

export function LeadCard({
  lead,
  highlights,
  onChange,
  showNotes = false,
}: {
  lead: Lead;
  highlights: string[];
  onChange: (lead: Lead) => void;
  showNotes?: boolean;
}) {
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function feedback(action: string) {
    setBusy(true);
    try {
      const data = await api<{ post: Lead }>(`/api/posts/${lead.id}/feedback`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      onChange(data.post);
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const data = await api<{ post: Lead }>(`/api/posts/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onChange(data.post);
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    const data = await api<{ note: Lead["notes"][number] }>(`/api/posts/${lead.id}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: note.trim() }),
    });
    setNote("");
    onChange({ ...lead, notes: [...lead.notes, data.note] });
  }

  async function copyReply() {
    await navigator.clipboard.writeText(lead.suggestedReply);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <article className={`rounded-2xl border bg-card p-4 shadow-sm ${lead.isRead ? "border-line" : "border-clay/40"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={lead.intent === "buyer" ? "pine" : lead.intent === "seller" ? "clay" : "neutral"}>
          {INTENT_LABEL[lead.intent] ?? lead.intent}
        </Badge>
        {lead.category ? <Badge>{lead.subcategory ? `${lead.category.name} / ${lead.subcategory.name}` : lead.category.name}</Badge> : null}
        <Badge tone={lead.score >= 80 ? "clay" : "neutral"}>{lead.score >= 80 ? `ร้อน ${lead.score}` : `คะแนน ${lead.score}`}</Badge>
        {lead.province ? <Badge tone="amber">{lead.province}</Badge> : null}
        {lead.isAd ? <Badge tone="danger">โฆษณา</Badge> : null}
        {lead.forbiddenHit ? <Badge tone="danger">คำต้องห้าม</Badge> : null}
        <span className="ml-auto text-xs text-muted">{timeAgo(lead.createdAt)}</span>
      </div>
      {lead.scoreReason ? <p className="mt-2 text-xs text-muted">{lead.scoreReason}</p> : null}
      {lead.duplicateOfId ? <p className="mt-1 text-xs text-clay">โพสต์คล้ายของเดิมใน 7 วัน</p> : null}
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
        <Highlight text={lead.text} words={highlights} />
      </p>
      {lead.images.length ? (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {lead.images.slice(0, 4).map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="h-20 w-20 rounded-lg object-cover" />
          ))}
        </div>
      ) : null}
      <div className="mt-3 text-xs text-muted">
        {lead.authorName || "ไม่ทราบชื่อ"} · {lead.source?.name ?? "ไม่ทราบแหล่ง"} · จัดโดย {lead.aiProvider || "rules"}
      </div>
      {lead.suggestedReply ? (
        <div className="mt-3 rounded-xl bg-paper px-3 py-2 text-sm leading-6">
          <div className="mb-1 text-xs font-medium text-muted">คำตอบแนะนำ — ก๊อปไปตอบเอง</div>
          {lead.suggestedReply}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={copyReply} disabled={!lead.suggestedReply}>
          {copied ? "คัดลอกแล้ว" : "คัดลอกคำตอบ"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => patch({ isRead: !lead.isRead })} disabled={busy}>
          {lead.isRead ? "ยังไม่อ่าน" : "อ่านแล้ว"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => feedback("dismiss")} disabled={busy}>ไม่สนใจ</Button>
        <Button size="sm" variant="pine" onClick={() => (lead.isSaved ? patch({ isSaved: false, pipelineStatus: "none" }) : feedback("save"))} disabled={busy}>
          {lead.isSaved ? "เอาออกจากไปป์ไลน์" : "เก็บเข้าไปป์ไลน์"}
        </Button>
        <a href={lead.externalUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-clay underline">
          เปิดโพสต์
        </a>
        {(lead.extraUrls ?? []).map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-clay underline">
            ลิงก์ที่ถูกตัด
          </a>
        ))}
        <select
          className="h-8 rounded-lg border border-line bg-card px-2 text-xs"
          value={lead.pipelineStatus}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "contacted" || value === "closed_won" || value === "closed_lost") void feedback(value);
            else if (value === "following") void feedback("save");
            else void patch({ pipelineStatus: value });
          }}
        >
          <option value="none">ยังไม่ติดตาม</option>
          {PIPELINE.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      {showNotes ? (
        <div className="mt-4 border-t border-line pt-3">
          {lead.notes.map((item) => (
            <p key={item.id} className="mb-2 text-sm text-muted">
              {item.body}
            </p>
          ))}
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="โน้ตส่วนตัว เช่น ทักแล้วเมื่อวาน รอราคา" />
          <Button size="sm" className="mt-2" variant="outline" onClick={addNote}>
            บันทึกโน้ต
          </Button>
        </div>
      ) : null}
    </article>
  );
}
