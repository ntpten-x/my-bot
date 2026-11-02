"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button, Card, Input, Select, Textarea } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import { invalidateTemplates } from "@/components/templates-store";
import type { CategoryRow, ReplyTemplateRow } from "@/lib/lead";
import { TEMPLATE_VARIABLES, renderTemplate } from "@/lib/templates";

const SAMPLE = { category: "แอร์", subcategory: "ล้างแอร์", province: "นนทบุรี", author: "สมชาย", source: "กลุ่มช่างนนท์" };

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<ReplyTemplateRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [max, setMax] = useState(50);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [data, cats] = await Promise.all([
        api<{ templates: ReplyTemplateRow[]; max: number }>("/api/templates"),
        api<{ categories: CategoryRow[] }>("/api/categories"),
      ]);
      setTemplates(data.templates);
      setMax(data.max);
      setCategories(cats.categories);
      invalidateTemplates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "โหลดไม่สำเร็จ");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/templates", { method: "POST", body: JSON.stringify({ name, body, categoryId: categoryId || null }) });
      setName("");
      setBody("");
      setError("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "บันทึกไม่สำเร็จ");
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">ข้อความสำเร็จรูป</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
        เตรียมคำตอบไว้ใช้ซ้ำ ในการ์ดลีดเลือกข้อความแล้วระบบจะเติมชื่อ หมวด จังหวัด และคัดลอกให้ทันที คุณเปิดโพสต์แล้ววางตอบเอง
        ระบบไม่โพสต์หรือคอมเมนต์แทนคุณ เพื่อไม่ให้บัญชีเฟซบุ๊กเสี่ยงโดนระงับ
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <h2 className="font-semibold">เพิ่มข้อความ ({templates.length}/{max})</h2>
          <form onSubmit={add} className="mt-3 grid gap-2">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="ชื่อ เช่น ทักลูกค้าล้างแอร์" maxLength={60} />
            <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} maxLength={2000}
              placeholder="สวัสดีครับคุณ{ชื่อ} รับงาน{หมวดย่อย} ใน{จังหวัด} ทักไลน์ได้เลยครับ" />
            <p className="text-xs text-muted">ตัวแปร: {TEMPLATE_VARIABLES.join(" ")}</p>
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">ใช้ได้ทุกหมวด</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>{item.parentId ? "— " : ""}{item.name}</option>
              ))}
            </Select>
            {body ? (
              <div className="rounded-xl bg-paper px-3 py-2 text-sm">
                <div className="text-xs text-muted">ตัวอย่าง</div>
                {renderTemplate(body, SAMPLE)}
              </div>
            ) : null}
            <Button type="submit" disabled={!name.trim() || !body.trim() || templates.length >= max}>บันทึกข้อความ</Button>
          </form>
        </Card>
        <Card>
          <h2 className="font-semibold">ข้อความที่มี</h2>
          {!templates.length ? <p className="mt-3 text-sm text-muted">ยังไม่มีข้อความสำเร็จรูป</p> : null}
          <div className="mt-3 space-y-3">
            {templates.map((item) => (
              <TemplateEditor key={item.id} template={item} categories={categories} onSaved={load} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function TemplateEditor({ template, categories, onSaved }: { template: ReplyTemplateRow; categories: CategoryRow[]; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);
  const [categoryId, setCategoryId] = useState(template.categoryId ?? "");
  const dirty = name !== template.name || body !== template.body || categoryId !== (template.categoryId ?? "");
  return (
    <div className="rounded-xl bg-paper p-3">
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="ชื่อข้อความ" />
        <span className="whitespace-nowrap text-xs text-muted">ใช้ {template.useCount} ครั้ง</span>
      </div>
      <Textarea className="mt-2" value={body} rows={3} onChange={(event) => setBody(event.target.value)} aria-label="ข้อความ" />
      <div className="mt-2 flex flex-wrap gap-2">
        <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">ทุกหมวด</option>
          {categories.map((item) => (
            <option key={item.id} value={item.id}>{item.parentId ? "— " : ""}{item.name}</option>
          ))}
        </Select>
        <Button size="sm" disabled={!dirty} onClick={async () => {
          await api(`/api/templates/${template.id}`, { method: "PATCH", body: JSON.stringify({ name, body, categoryId: categoryId || null }) });
          await onSaved();
        }}>บันทึก</Button>
        <Button size="sm" variant="outline" onClick={async () => {
          if (!window.confirm(`ลบ "${template.name}"?`)) return;
          await api(`/api/templates/${template.id}`, { method: "DELETE" });
          await onSaved();
        }}>ลบ</Button>
      </div>
    </div>
  );
}
