"use client";

import { useState } from "react";
import { Badge, Button, Textarea } from "@/components/ui";
import { Highlight } from "@/components/highlight";
import { api } from "@/components/api";
import { INTENT_LABEL, PIPELINE, timeAgo } from "@/lib/format";
import type { Lead } from "@/lib/lead";
import { renderTemplate } from "@/lib/templates";
import { useTemplates } from "@/components/templates-store";
import { assistReply } from "@/components/assist-reply";
import { pickTemplate } from "@/lib/reply-queue-core";

function bangkokDate(iso: string) {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

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
  const [templateText, setTemplateText] = useState("");
  const [assistNote, setAssistNote] = useState("");
  const [awaitingSent, setAwaitingSent] = useState(false);
  const templates = useTemplates();
  const usable = templates.filter((item) => !item.categoryId || item.categoryId === lead.category?.id || item.categoryId === lead.subcategory?.id);

  function fill(body: string) {
    return renderTemplate(body, {
      category: lead.category?.name,
      subcategory: lead.subcategory?.name,
      province: lead.province,
      author: lead.authorName,
      source: lead.source?.name,
    });
  }

  // "ตอบลีดนี้": chosen template, else the rule/AI draft, else the least-used matching template.
  async function replyToLead() {
    let text = templateText || lead.suggestedReply.trim();
    let usedId: string | null = null;
    if (!text) {
      const template = pickTemplate(usable, [lead.category?.id, lead.subcategory?.id], new Map());
      if (template) {
        text = fill(template.body);
        usedId = template.id;
        setTemplateText(text);
      }
    }
    if (!text) {
      setAssistNote("ยังไม่มีข้อความตอบ — สร้างข้อความสำเร็จรูปที่หน้า ข้อความสำเร็จรูป ก่อน");
      return;
    }
    const result = await assistReply(lead.externalUrl, text);
    setAssistNote(result.message);
    setAwaitingSent(true);
    if (usedId) void api(`/api/templates/${usedId}`, { method: "PATCH", body: JSON.stringify({ used: true }) }).catch(() => undefined);
  }

  async function applyTemplate(id: string) {
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    const text = renderTemplate(template.body, {
      category: lead.category?.name,
      subcategory: lead.subcategory?.name,
      province: lead.province,
      author: lead.authorName,
      source: lead.source?.name,
    });
    setTemplateText(text);
    await navigator.clipboard.writeText(text).catch(() => undefined);
    void api(`/api/templates/${id}`, { method: "PATCH", body: JSON.stringify({ used: true }) }).catch(() => undefined);
  }

  function snooze(days: number) {
    void patch({ followUpAt: new Date(Date.now() + days * 86_400_000).toISOString() });
  }

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
      {lead.contacts?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {lead.contacts.map((contact) => (
            <a
              key={contact.href}
              href={contact.href}
              target={contact.type === "phone" ? undefined : "_blank"}
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-lg border border-pine/40 bg-pine/10 px-3 text-xs font-medium text-pine"
            >
              {contact.type === "phone" ? `โทร ${contact.value}` : contact.type === "line" ? `LINE ${contact.value}` : "Messenger"}
            </a>
          ))}
        </div>
      ) : null}
      {lead.alsoIn?.length ? (
        <div className="mt-2 text-xs text-muted">
          โพสต์เดียวกันในอีก {lead.alsoIn.length} ที่:{" "}
          {lead.alsoIn.map((item, index) => (
            <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="text-clay underline">
              {item.source || `ลิงก์ ${index + 1}`}
              {index < lead.alsoIn!.length - 1 ? ", " : ""}
            </a>
          ))}
        </div>
      ) : null}
      {lead.followUpAt && ["following", "replied", "contacted"].includes(lead.pipelineStatus) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className={new Date(lead.followUpAt).getTime() <= Date.now() ? "font-medium text-clay" : ""}>นัดตามลีด {bangkokDate(lead.followUpAt)} (เวลาไทย)</span>
          <button type="button" className="underline" onClick={() => snooze(1)} disabled={busy}>เลื่อน 1 วัน</button>
          <button type="button" className="underline" onClick={() => void patch({ followUpAt: null })} disabled={busy}>ไม่ต้องเตือน</button>
        </div>
      ) : null}
      {lead.suggestedReply ? (
        <div className="mt-3 rounded-xl bg-paper px-3 py-2 text-sm leading-6">
          <div className="mb-1 text-xs font-medium text-muted">คำตอบแนะนำ — ก๊อปไปตอบเอง</div>
          {lead.suggestedReply}
        </div>
      ) : null}
      {templateText ? (
        <div className="mt-3 rounded-xl border border-pine/30 bg-pine/5 px-3 py-2 text-sm leading-6">
          <div className="mb-1 text-xs font-medium text-pine">ข้อความที่จะใช้ตอบ (คัดลอกแล้ว) — กด ตอบลีดนี้ หรือเปิดโพสต์แล้ววางเอง</div>
          {templateText}
        </div>
      ) : null}
      {assistNote ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-xs" role="status">
          <span>{assistNote}</span>
          {awaitingSent ? (
            <>
              <Button size="sm" variant="pine" disabled={busy} onClick={() => void patch({ pipelineStatus: "replied" }).then(() => { setAwaitingSent(false); setAssistNote("บันทึกว่าตอบแล้ว"); })}>
                ส่งแล้ว
              </Button>
              <button type="button" className="underline" onClick={() => { setAwaitingSent(false); setAssistNote(""); }}>ยังไม่ได้ส่ง</button>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="pine" onClick={() => void replyToLead()} disabled={busy || lead.isAd || lead.forbiddenHit} title="เปิดโพสต์และใส่ข้อความให้ คุณกดส่งเอง">
          ตอบลีดนี้
        </Button>
        {usable.length ? (
          <select
            className="h-8 max-w-48 rounded-lg border border-line bg-card px-2 text-xs"
            value=""
            onChange={(event) => void applyTemplate(event.target.value)}
            aria-label="ข้อความสำเร็จรูป"
          >
            <option value="">ข้อความสำเร็จรูป…</option>
            {usable.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        ) : null}
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
