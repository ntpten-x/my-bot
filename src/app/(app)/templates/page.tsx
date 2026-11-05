"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Select, Textarea } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import { invalidateTemplates } from "@/components/templates-store";
import type { CategoryRow, ReplyTemplateRow } from "@/lib/lead";
import { TEMPLATE_VARIABLES, renderTemplate } from "@/lib/templates";
import { templateSources } from "@/lib/reply-queue-core";

type ProductOpt = { id: string; name: string; categorySlug: string; enabled: boolean };
type SourceOpt = { id: string; name: string };
type Lookups = { categories: CategoryRow[]; products: ProductOpt[]; sources: SourceOpt[] };

const SAMPLE = { category: "เกม", subcategory: "ไอดีเกม", province: "นนทบุรี", author: "สมชาย", source: "กลุ่มซื้อขาย Roblox", product: "Roblox" };
const NONE = "__none";

/** Key of a template's set: product + groups (+ category when no product). */
function setKey(item: ReplyTemplateRow) {
  return `${item.productId ?? ""}|${item.productId ? "" : item.categoryId ?? ""}|${templateSources(item.sourceIds).sort().join(",")}`;
}

function setTitle(item: ReplyTemplateRow, look: Lookups) {
  const parts: string[] = [];
  if (item.productId) parts.push(look.products.find((p) => p.id === item.productId)?.name ?? "เกม/สินค้า (ถูกลบ)");
  else if (item.categoryId) parts.push(look.categories.find((c) => c.id === item.categoryId)?.name ?? "หมวด");
  const src = templateSources(item.sourceIds);
  if (src.length) {
    const names = src.map((id) => look.sources.find((s) => s.id === id)?.name ?? "กลุ่ม").slice(0, 2);
    parts.push(`เฉพาะ ${names.join(", ")}${src.length > 2 ? ` +${src.length - 2}` : ""}`);
  }
  return parts.length ? parts.join(" · ") : "ทั่วไป (ทุกเกม ทุกกลุ่ม)";
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<ReplyTemplateRow[]>([]);
  const [look, setLook] = useState<Lookups>({ categories: [], products: [], sources: [] });
  const [max, setMax] = useState(300);
  const [filterProduct, setFilterProduct] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [data, cats, prods, srcs] = await Promise.all([
        api<{ templates: ReplyTemplateRow[]; max: number }>("/api/templates"),
        api<{ categories: CategoryRow[] }>("/api/categories"),
        api<{ products: ProductOpt[] }>("/api/products").catch(() => ({ products: [] as ProductOpt[] })),
        api<{ sources: SourceOpt[] }>("/api/sources").catch(() => ({ sources: [] as SourceOpt[] })),
      ]);
      setTemplates(data.templates);
      setMax(data.max);
      setLook({ categories: cats.categories, products: prods.products, sources: srcs.sources.map((s) => ({ id: s.id, name: s.name })) });
      invalidateTemplates();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "โหลดไม่สำเร็จ");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const groups = useMemo(() => {
    const shown = templates.filter((item) => {
      if (filterProduct === NONE && item.productId) return false;
      if (filterProduct && filterProduct !== NONE && item.productId !== filterProduct) return false;
      if (filterSource) {
        const src = templateSources(item.sourceIds);
        if (src.length && !src.includes(filterSource)) return false; // "" = every group, still applies
      }
      return true;
    });
    const map = new Map<string, ReplyTemplateRow[]>();
    for (const item of shown) map.set(setKey(item), [...(map.get(setKey(item)) ?? []), item]);
    // Specific sets first, the general set last.
    return [...map.values()].sort((a, b) => Number(!a[0].productId && !a[0].categoryId) - Number(!b[0].productId && !b[0].categoryId) || b.length - a.length);
  }, [templates, filterProduct, filterSource]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">ข้อความสำเร็จรูป</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
        สร้างข้อความเป็นชุดตามเกม/สินค้า (เช่น Roblox ข้อความ 1–9) และเลือกได้ว่าใช้กับกลุ่มไหน ระบบจะเลือกชุดที่ตรงที่สุดให้ก่อน
        (กลุ่ม+เกม › เกม › หมวด › ทั่วไป) แล้ววนข้อความที่ใช้น้อยที่สุดในชุดนั้น ไม่ซ้ำกันติดๆ คุณเปิดโพสต์แล้วกดส่งเอง ระบบไม่โพสต์แทน
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <h2 className="font-semibold">เพิ่มข้อความ ({templates.length}/{max})</h2>
          <TemplateForm look={look} templates={templates} full={templates.length >= max} presetProduct={filterProduct !== NONE ? filterProduct : ""}
            onSaved={load} onError={setError} />
        </Card>
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">ข้อความที่มี</h2>
            <Select value={filterProduct} onChange={(event) => setFilterProduct(event.target.value)} aria-label="กรองตามเกม/สินค้า">
              <option value="">ทุกเกม/สินค้า</option>
              <option value={NONE}>ไม่ระบุเกม</option>
              {look.products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({templates.filter((t) => t.productId === p.id).length})</option>
              ))}
            </Select>
            <Select value={filterSource} onChange={(event) => setFilterSource(event.target.value)} aria-label="กรองตามกลุ่ม">
              <option value="">ทุกกลุ่ม</option>
              {look.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          {!groups.length ? <p className="mt-3 text-sm text-muted">ยังไม่มีข้อความในตัวกรองนี้</p> : null}
          <div className="mt-3 space-y-4">
            {groups.map((rows) => (
              <details key={setKey(rows[0])} open className="rounded-xl border border-line p-2">
                <summary className="cursor-pointer text-sm font-semibold">
                  {setTitle(rows[0], look)} <span className="font-normal text-muted">· {rows.length} ข้อความ · ใช้รวม {rows.reduce((n, r) => n + r.useCount, 0)} ครั้ง</span>
                </summary>
                <div className="mt-2 space-y-3">
                  {rows.map((item) => <TemplateEditor key={item.id} template={item} look={look} onSaved={load} />)}
                </div>
              </details>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ScopeFields({ look, categoryId, setCategoryId, productId, setProductId, sourceIds, setSourceIds }: {
  look: Lookups;
  categoryId: string; setCategoryId: (v: string) => void;
  productId: string; setProductId: (v: string) => void;
  sourceIds: string[]; setSourceIds: (v: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const topSlug = (() => {
    const cat = look.categories.find((c) => c.id === categoryId);
    if (!cat) return "";
    const top = cat.parentId ? look.categories.find((c) => c.id === cat.parentId) : cat;
    return top?.slug ?? "";
  })();
  const products = look.products.filter((p) => !topSlug || p.categorySlug === topSlug || p.id === productId);
  const sources = look.sources.filter((s) => !query || s.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} aria-label="หมวด">
          <option value="">ทุกหมวด</option>
          {look.categories.map((item) => (
            <option key={item.id} value={item.id}>{item.parentId ? "— " : ""}{item.name}</option>
          ))}
        </Select>
        <Select value={productId} onChange={(event) => setProductId(event.target.value)} aria-label="เกม/สินค้า">
          <option value="">ทุกเกม/สินค้า</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <details className="rounded-lg border border-line px-2 py-1 text-sm">
        <summary className="cursor-pointer">ใช้กับกลุ่ม: {sourceIds.length ? `${sourceIds.length} กลุ่มที่เลือก` : "ทุกกลุ่ม"}</summary>
        <Input className="mt-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหากลุ่ม" />
        <div className="mt-2 max-h-48 space-y-1 overflow-auto">
          {sources.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={sourceIds.includes(s.id)}
                onChange={(event) => setSourceIds(event.target.checked ? [...sourceIds, s.id] : sourceIds.filter((id) => id !== s.id))} />
              {s.name}
            </label>
          ))}
        </div>
        {sourceIds.length ? <button type="button" className="mt-1 text-xs underline" onClick={() => setSourceIds([])}>ล้าง = ใช้ทุกกลุ่ม</button> : null}
      </details>
    </div>
  );
}

function TemplateForm({ look, templates, full, presetProduct, onSaved, onError }: {
  look: Lookups; templates: ReplyTemplateRow[]; full: boolean; presetProduct: string;
  onSaved: () => Promise<void>; onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [productId, setProductId] = useState(presetProduct);
  const [sourceIds, setSourceIds] = useState<string[]>([]);

  useEffect(() => setProductId(presetProduct), [presetProduct]);

  // Auto name, e.g. "Roblox ข้อความ 4" when the set already has 3.
  const productName = look.products.find((p) => p.id === productId)?.name ?? "";
  const inSet = templates.filter((t) => (t.productId ?? "") === productId && templateSources(t.sourceIds).sort().join(",") === [...sourceIds].sort().join(",")).length;
  const autoName = `${productName || "ทั่วไป"} ข้อความ ${inSet + 1}`;

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/templates", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || autoName, body, categoryId: categoryId || null, productId: productId || null, sourceIds }),
      });
      setName("");
      setBody("");
      onError("");
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "บันทึกไม่สำเร็จ");
    }
  }

  return (
    <form onSubmit={add} className="mt-3 grid gap-2">
      <ScopeFields look={look} categoryId={categoryId} setCategoryId={setCategoryId} productId={productId} setProductId={setProductId}
        sourceIds={sourceIds} setSourceIds={setSourceIds} />
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={autoName} maxLength={60} aria-label="ชื่อข้อความ" />
      <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} maxLength={2000}
        placeholder="สวัสดีครับคุณ{ชื่อ} รับซื้อ-ขายไอดี {เกม} ราคาดี ทักแชทได้เลยครับ" />
      <p className="text-xs text-muted">ตัวแปร: {TEMPLATE_VARIABLES.join(" ")} · ชุดนี้มี {inSet} ข้อความ</p>
      {body ? (
        <div className="rounded-xl bg-paper px-3 py-2 text-sm">
          <div className="text-xs text-muted">ตัวอย่าง</div>
          {renderTemplate(body, { ...SAMPLE, product: productName || SAMPLE.product })}
        </div>
      ) : null}
      <Button type="submit" disabled={!body.trim() || full}>บันทึกข้อความ</Button>
    </form>
  );
}

function TemplateEditor({ template, look, onSaved }: { template: ReplyTemplateRow; look: Lookups; onSaved: () => Promise<void> }) {
  const initialSources = templateSources(template.sourceIds);
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);
  const [categoryId, setCategoryId] = useState(template.categoryId ?? "");
  const [productId, setProductId] = useState(template.productId ?? "");
  const [sourceIds, setSourceIds] = useState<string[]>(initialSources);
  const dirty = name !== template.name || body !== template.body || categoryId !== (template.categoryId ?? "")
    || productId !== (template.productId ?? "") || [...sourceIds].sort().join(",") !== [...initialSources].sort().join(",");
  return (
    <div className="rounded-xl bg-paper p-3">
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="ชื่อข้อความ" />
        <span className="whitespace-nowrap text-xs text-muted">ใช้ {template.useCount} ครั้ง</span>
      </div>
      <Textarea className="mt-2" value={body} rows={3} onChange={(event) => setBody(event.target.value)} aria-label="ข้อความ" />
      <div className="mt-2">
        <ScopeFields look={look} categoryId={categoryId} setCategoryId={setCategoryId} productId={productId} setProductId={setProductId}
          sourceIds={sourceIds} setSourceIds={setSourceIds} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" disabled={!dirty} onClick={async () => {
          await api(`/api/templates/${template.id}`, {
            method: "PATCH",
            body: JSON.stringify({ name, body, categoryId: categoryId || null, productId: productId || null, sourceIds }),
          });
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
