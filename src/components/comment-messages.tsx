"use client";

import { Button, Label, Textarea } from "@/components/ui";

export function CommentMessages({ messages, onChange }: { messages: string[]; onChange: (messages: string[]) => void }) {
  return <fieldset className="space-y-3 rounded-xl border border-line bg-paper/40 p-4">
    <legend className="px-1 font-semibold">ข้อความที่ให้บอทคอมเมนต์</legend>
    <p className="text-sm text-muted">เขียนข้อความที่พร้อมส่งจริง บอทเลือกใช้หนึ่งข้อความต่อโพสต์ตามลำดับหรือสุ่ม ไม่ต้องรอ AI ร่างคำตอบ</p>
    {messages.map((message, index) => {
      const id = index === 0 ? "comment-templates" : `comment-template-${index}`;
      return <div key={index} className="rounded-lg border border-line bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2"><Label htmlFor={id}>ข้อความที่ {index + 1}</Label><Button type="button" size="sm" variant="outline" disabled={messages.length === 1} aria-label={`ลบข้อความที่ ${index + 1}`} onClick={() => onChange(messages.filter((_, position) => position !== index))}>ลบ</Button></div>
        <Textarea id={id} value={message} required maxLength={2000} rows={4} onChange={event => onChange(messages.map((value, position) => position === index ? event.target.value : value))} />
        <p className="mt-1 text-right text-xs text-muted" aria-live="off">{message.length.toLocaleString("th-TH")} / 2,000 ตัวอักษร</p>
      </div>;
    })}
    <Button type="button" variant="outline" disabled={messages.length >= 30} onClick={() => onChange([...messages, ""])}>เพิ่มข้อความ ({messages.length}/30)</Button>
  </fieldset>;
}
