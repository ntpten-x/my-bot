"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { GroupTaxonomyFields, type GroupType } from "@/components/group-taxonomy";
import { api } from "@/components/api";
import { Badge, Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { invalidateTemplates } from "@/components/templates-store";

type Category = { id: string; slug: string; name: string; parentId: string | null };
type Message = {
  id: string;
  name: string;
  body: string;
  categoryId: string | null;
  productId: string | null;
  sourceIds: string;
  useCount: number;
  imagePath?: string | null;
  imageUrl?: string | null;
};
type Group = { type: string; boundCategorySlug: string; defaultProductId: string | null };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_MAX = Math.floor(2.5 * 1024 * 1024);
const IMAGE_MAX_LABEL = "2.5 MB";

export default function MessagesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [types, setTypes] = useState<GroupType[]>([]);
  const [productId, setProductId] = useState("");
  const [filterType, setFilterType] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [limit, setLimit] = useState(300);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [clearImage, setClearImage] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [imageStorageReady, setImageStorageReady] = useState(true);
  async function load() {
    const [templates, taxonomy, sources, products] = await Promise.all([
      api<{ templates: Message[]; max: number; imageStorageReady?: boolean }>("/api/templates"),
      api<{ categories: Category[] }>("/api/categories"),
      api<{ sources: Group[] }>("/api/sources"),
      api<{ products: GroupType[] }>("/api/products"),
    ]);
    setMessages(templates.templates); setLimit(templates.max);
    setImageStorageReady(templates.imageStorageReady !== false);
    setCategories(taxonomy.categories.filter(row => !row.parentId));
    setGroups(sources.sources.filter(row => row.type === "facebook_group")); setTypes(products.products);
  }
  useEffect(() => { load().catch(err => setError(err instanceof Error ? err.message : "โหลดข้อความไม่สำเร็จ")).finally(() => setLoading(false)); }, []);
  useEffect(() => () => { if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview); }, [imagePreview]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setInfo("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { setBusy(false); }
  }
  function reset() {
    setEditing(null); setName(""); setBody(""); setImageFile(null); setClearImage(false);
    setExistingImageUrl(null);
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
  }
  function pickImage(file: File | null) {
    if (!file) { setImageFile(null); if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview); setImagePreview(null); return; }
    if (!IMAGE_TYPES.includes(file.type)) { setError("รองรับเฉพาะ JPEG, PNG หรือ WebP"); return; }
    if (file.size > IMAGE_MAX) { setError(`รูปต้องมีขนาดไม่เกิน ${IMAGE_MAX_LABEL}`); return; }
    if (!imageStorageReady) { setError("ยังไม่ได้ตั้งค่า Storage สำหรับรูปข้อความ (ต้องมี SUPABASE_SERVICE_ROLE_KEY)"); return; }
    setError("");
    setClearImage(false);
    setImageFile(file);
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setImagePreview(URL.createObjectURL(file));
  }
  async function uploadImage(templateId: string, file: File) {
    const form = new FormData();
    form.set("templateId", templateId);
    form.set("file", file);
    await api("/api/templates/image", { method: "POST", body: form });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (!categories.some(row => row.id === categoryId)) throw new Error("กรุณาเลือกหมวดหมู่");
      if (editing) {
        await api(`/api/templates/${editing}`, {
          method: "PATCH",
          body: JSON.stringify({ categoryId, productId: productId || null, name, body, ...(clearImage ? { clearImage: true } : {}) }),
        });
        if (imageFile) await uploadImage(editing, imageFile);
      } else {
        const created = await api<{ template: Message }>("/api/templates", {
          method: "POST", body: JSON.stringify({ categoryId, productId: productId || null, name, body }),
        });
        if (imageFile) await uploadImage(created.template.id, imageFile);
      }
      setInfo(editing ? "บันทึกการแก้ไขข้อความแล้ว" : "สร้างข้อความแล้ว เพิ่มชุดถัดไปในประเภทเดิมได้เลย");
      reset(); invalidateTemplates(); await load();
    });
  }
  const managed = messages.filter(row => categories.some(category => category.id === row.categoryId) && !row.sourceIds);
  const visible = managed.filter(row => (!filter || row.categoryId === filter) && (!filterType || (filterType === "__category" ? !row.productId : row.productId === filterType)) && `${row.name} ${row.body}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selected = categories.find(row => row.id === categoryId);
  const previewSrc = imagePreview || (!clearImage ? existingImageUrl : null);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">จัดการข้อความ</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-muted">เตรียมข้อความคอมเมนต์แยกตามหมวดหมู่และประเภท แต่ละประเภทสร้างได้หลายชุด ตั้งชื่อให้เลือกใช้ได้ง่าย แนบรูปได้หนึ่งรูปต่อข้อความ</p></div><Link href="/groups" className="text-sm text-pine underline underline-offset-4">จัดการหมวดหมู่และประเภท</Link></div>
    {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {info ? <p role="status" className="rounded-lg bg-pine/10 p-3 text-sm text-pine">{info}</p> : null}
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Card className="border-t-4 border-t-pine">
        <h2 className="text-lg font-semibold">{editing ? "แก้ไขข้อความ" : "สร้างข้อความ"}</h2>
        <form onSubmit={save} className="mt-4 space-y-4">
          <div><GroupTaxonomyFields id="message" categories={categories} types={types} categorySlug={selected?.slug ?? ""} typeId={productId} required allowCategoryOnly disabled={busy || loading} onChange={(slug, type) => { setCategoryId(categories.find(row => row.slug === slug)?.id ?? ""); setProductId(type); }} />
            {selected ? <p className="mt-2 text-xs text-muted">{productId ? `ใช้กับประเภท ${types.find(row => row.id === productId)?.name ?? ""}` : "ใช้ได้กับทุกประเภทในหมวดหมู่นี้"} · {groups.filter(row => row.boundCategorySlug === selected.slug && (!productId || row.defaultProductId === productId)).length} กลุ่ม</p> : null}
            {!loading && !categories.length ? <Link href="/groups" className="mt-2 block text-sm text-pine underline">ยังไม่มีหมวดหมู่ ไปสร้างหมวดหมู่ก่อน</Link> : null}
          </div>
          <div><Label htmlFor="message-name">ชื่อข้อความ</Label><Input id="message-name" required maxLength={60} disabled={busy} value={name} onChange={event => setName(event.target.value)} placeholder="เช่น แนะนำร้าน / แจ้งโปรโมชัน / สอบถามรายละเอียด" /></div>
          <div><Label htmlFor="message-body">ข้อความที่จะนำไปคอมเมนต์</Label><Textarea id="message-body" required rows={7} maxLength={2000} disabled={busy} value={body} onChange={event => setBody(event.target.value)} placeholder="พิมพ์ข้อความที่ต้องการใช้คอมเมนต์..." /><p className="mt-1 text-right text-xs text-muted">{body.length.toLocaleString()} / 2,000 ตัวอักษร</p></div>
          <div>
            <Label htmlFor="message-image">รูปประกอบ (ไม่บังคับ)</Label>
            <Input id="message-image" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !imageStorageReady} onChange={event => pickImage(event.target.files?.[0] ?? null)} />
            <p className="mt-1 text-xs text-muted">JPEG / PNG / WebP ไม่เกิน {IMAGE_MAX_LABEL} · เมื่อกฎเลือกข้อความนี้ บอทจะส่งข้อความพร้อมรูป</p>
            {!imageStorageReady ? <p role="alert" className="mt-2 text-xs text-red-800">ยังแนบรูปไม่ได้ — ตั้งค่า `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ใน `.env` (และบน Render) แล้วรีสตาร์ทแอป</p> : null}
            {previewSrc ? <div className="mt-3 flex flex-wrap items-end gap-3"><img src={previewSrc} alt="ตัวอย่างรูปข้อความ" decoding="async" width={96} height={96} className="h-24 w-24 rounded-md border border-line object-cover" /><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { pickImage(null); setClearImage(Boolean(editing && existingImageUrl)); }}>ลบรูป</Button></div> : null}
          </div>
          {body.trim() ? <div className="rounded-lg border border-line p-3"><p className="mb-2 text-xs text-muted">ตัวอย่างข้อความ</p><p className="whitespace-pre-wrap break-words text-sm">{body}</p></div> : null}
          <div className="flex flex-wrap gap-2"><Button variant="pine" type="submit" disabled={loading || busy || !categoryId || !name.trim() || !body.trim() || (!editing && messages.length >= limit)}>{busy ? "กำลังบันทึก..." : editing ? "บันทึกการแก้ไข" : "สร้างข้อความ"}</Button>{editing ? <Button variant="outline" type="button" disabled={busy} onClick={reset}>ยกเลิกแก้ไข</Button> : null}</div>
          {messages.length >= limit ? <p className="text-sm text-red-800">ข้อความครบ {limit} ชุดแล้ว ลบข้อความที่ไม่ใช้ก่อนเพิ่มชุดใหม่</p> : null}
        </form>
        <p className="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">การบันทึกเป็นการเตรียมข้อความไว้เลือกใช้ ยังไม่ส่งคอมเมนต์หรือเปิดระบบอัตโนมัติ</p>
      </Card>
      <section aria-label="ชุดข้อความ" className="min-w-0 space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">ชุดข้อความ ({visible.length})</h2><span className="text-xs text-muted">ทั้งหมดในระบบ {messages.length}/{limit}</span></div>
        <div className="grid gap-2 sm:grid-cols-2"><div><Label htmlFor="filter-message-category">กรองหมวดหมู่</Label><Select id="filter-message-category" value={filter} onChange={event => { setFilter(event.target.value); setFilterType(""); }}><option value="">ทุกหมวดหมู่</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name} ({managed.filter(item => item.categoryId === row.id).length})</option>)}</Select></div><div><Label htmlFor="search-messages">ค้นหาข้อความ</Label><Input id="search-messages" value={query} onChange={event => setQuery(event.target.value)} placeholder="ค้นหาชื่อหรือเนื้อหา" /></div></div>
        <div><Label htmlFor="filter-message-type">กรองประเภท</Label><Select id="filter-message-type" value={filterType} onChange={event => setFilterType(event.target.value)}><option value="">ทุกประเภท</option><option value="__category">ข้อความที่ใช้ทั้งหมวดหมู่</option>{types.filter(row => !filter || row.categorySlug === categories.find(cat => cat.id === filter)?.slug).map(row => <option key={row.id} value={row.id}>{categories.find(cat => cat.slug === row.categorySlug)?.name} / {row.name}</option>)}</Select></div>
        {loading ? <p role="status" className="py-6 text-sm text-muted">กำลังโหลดข้อความ...</p> : !visible.length ? <Card><p className="py-4 text-sm text-muted">{managed.length ? "ไม่พบข้อความ ลองเปลี่ยนประเภทหรือคำค้น" : "ยังไม่มีชุดข้อความ เลือกประเภท ตั้งชื่อ แล้วสร้างข้อความแรกได้เลย"}</p></Card> : visible.map(row => <Card key={row.id}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-words font-semibold">{row.name}</h3><Badge tone="pine">{categories.find(category => category.id === row.categoryId)?.name} / {row.productId ? types.find(type => type.id === row.productId)?.name ?? "ประเภทที่ถูกลบ" : "ทุกประเภท"}</Badge></div>
          <div className="mt-3 flex gap-3">
            {row.imageUrl ? <img src={row.imageUrl} alt="" loading="lazy" decoding="async" width={64} height={64} className="h-16 w-16 shrink-0 rounded-md border border-line object-cover" /> : null}
            <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6">{row.body}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(row.id); setCategoryId(row.categoryId ?? ""); setProductId(row.productId ?? ""); setName(row.name); setBody(row.body); setImageFile(null); setClearImage(false); setExistingImageUrl(row.imageUrl ?? null); if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview); setImagePreview(null); setError(""); setInfo(""); document.getElementById("message-name")?.focus(); }}>แก้ไข</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(row.body); setInfo(`คัดลอก “${row.name}” แล้ว`); })}>คัดลอก</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => { if (!confirm(`ลบข้อความ “${row.name}”?`)) return; void run(async () => { await api(`/api/templates/${row.id}`, { method: "DELETE" }); if (editing === row.id) reset(); invalidateTemplates(); setInfo(`ลบข้อความ “${row.name}” แล้ว`); await load(); }); }}>ลบ</Button>
          </div>
        </Card>)}
        <p className="text-xs leading-5 text-muted">ข้อความทั่วไปหรือที่เจาะจงรายกลุ่ม จัดการได้ที่ <Link href="/templates" className="text-pine underline">ข้อความสำเร็จรูปแบบละเอียด</Link></p>
      </section>
    </div>
  </div>;
}
