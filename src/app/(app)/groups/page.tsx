"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/components/api";
import { Badge, Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { GroupTaxonomyFields, type GroupCategory, type GroupType } from "@/components/group-taxonomy";

type Group = { id: string; name: string; url: string; enabled: boolean; boundCategorySlug: string; defaultProductId: string | null; postCount: number };
type Edit = { kind: "category" | "type"; id: string; name: string };

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [categories, setCategories] = useState<GroupCategory[]>([]);
  const [types, setTypes] = useState<GroupType[]>([]);
  const [filter, setFilter] = useState("");
  const [filterType, setFilterType] = useState("");
  const [search, setSearch] = useState("");
  const [urls, setUrls] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [typeId, setTypeId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [typeCategory, setTypeCategory] = useState("");
  const [typeName, setTypeName] = useState("");
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<Edit | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  async function load() {
    const [sources, taxonomy, products] = await Promise.all([
      api<{ sources: (Group & { type: string })[] }>("/api/sources"),
      api<{ categories: GroupCategory[] }>("/api/categories"),
      api<{ products: GroupType[] }>("/api/products"),
    ]);
    setGroups(sources.sources.filter(row => row.type === "facebook_group"));
    setCategories(taxonomy.categories.filter(row => !row.parentId)); setTypes(products.products);
  }
  useEffect(() => { load().catch(err => setError(err instanceof Error ? err.message : "โหลดกลุ่มไม่สำเร็จ")).finally(() => setLoading(false)); }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setInfo("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { setBusy(false); }
  }
  function addGroups(event: FormEvent) {
    event.preventDefault(); void run(async () => {
      if (!category || !typeId) throw new Error("เลือกหมวดหมู่และประเภทก่อนเพิ่มกลุ่ม");
      const result = await api<{ created: number; skipped: string[] }>("/api/sources", { method: "POST", body: JSON.stringify({ urls, name, type: "facebook_group", boundCategorySlug: category, defaultProductId: typeId }) });
      setUrls(result.skipped.join("\n")); if (!result.skipped.length) setName("");
      setInfo(`เพิ่มแล้ว ${result.created} กลุ่ม${result.skipped.length ? ` · เพิ่มไม่ได้ ${result.skipped.length} ลิงก์ ลิงก์ซ้ำหรือไม่ถูกต้องยังอยู่ในช่องให้แก้ไข` : ""}`); await load();
    });
  }
  function createCategory(event: FormEvent) {
    event.preventDefault(); void run(async () => {
      const trimmed = categoryName.trim();
      if (!trimmed) throw new Error("ตั้งชื่อหมวดหมู่ก่อน");
      if (categories.some(row => row.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) throw new Error("มีหมวดหมู่ชื่อนี้แล้ว");
      const result = await api<{ category: GroupCategory }>("/api/categories", { method: "POST", body: JSON.stringify({ name: trimmed }) });
      setCategoryName(""); setTypeCategory(result.category.slug); setCategory(result.category.slug); setTypeId("");
      setInfo(`สร้างหมวดหมู่ “${trimmed}” แล้ว สร้างประเภทภายใต้หมวดหมู่นี้ได้เลย`); await load();
    });
  }
  function createType(event: FormEvent) {
    event.preventDefault(); void run(async () => {
      const trimmed = typeName.trim();
      if (!trimmed || !typeCategory) throw new Error("เลือกหมวดหมู่และตั้งชื่อประเภทก่อน");
      if (types.some(row => row.categorySlug === typeCategory && row.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) throw new Error("มีประเภทชื่อนี้ในหมวดหมู่แล้ว");
      const result = await api<{ product: GroupType }>("/api/products", { method: "POST", body: JSON.stringify({ name: trimmed, categorySlug: typeCategory }) });
      setTypeName(""); setCategory(typeCategory); setTypeId(result.product.id);
      setInfo(`สร้างประเภท “${trimmed}” แล้ว`); await load();
    });
  }
  function rename(event: FormEvent) {
    event.preventDefault(); if (!editing) return;
    void run(async () => {
      const trimmed = editing.name.trim();
      if (!trimmed) throw new Error("กรุณาตั้งชื่อก่อนบันทึก");
      const duplicate = editing.kind === "category"
        ? categories.some(row => row.id !== editing.id && row.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
        : types.some(row => row.id !== editing.id && row.categorySlug === types.find(item => item.id === editing.id)?.categorySlug && row.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
      if (duplicate) throw new Error("มีชื่อนี้อยู่แล้ว");
      await api(`/api/${editing.kind === "category" ? "categories" : "products"}/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name: trimmed }) });
      setEditing(null); setInfo("เปลี่ยนชื่อแล้ว"); await load();
    });
  }
  function remove(kind: "category" | "type", row: { id: string; name: string; slug?: string }) {
    const warning = kind === "category" ? "ลบได้เมื่อไม่มีประเภท หมวดย่อย หรือชุดข้อความ กลุ่มจะกลับไปเป็นยังไม่จัดหมวดหมู่ และหมวดโพสต์ที่อ้างหมวดนี้จะถูกยกเลิก" : "กลุ่มจะคงหมวดหมู่เดิมและกลับไปเป็นยังไม่เลือกประเภท ป้ายประเภทของโพสต์เดิมจะถูกยกเลิก หากมีชุดข้อความต้องย้ายหรือลบข้อความก่อน";
    if (!confirm(`ลบ${kind === "category" ? "หมวดหมู่" : "ประเภท"} “${row.name}”? ${warning} กลุ่มและโพสต์จะยังอยู่`)) return;
    void run(async () => {
      await api(`/api/${kind === "category" ? "categories" : "products"}/${row.id}`, { method: "DELETE" });
      if (kind === "category") {
        if (category === row.slug) { setCategory(""); setTypeId(""); }
        if (typeCategory === row.slug) setTypeCategory("");
        if (filter === row.slug) { setFilter(""); setFilterType(""); }
      } else { if (typeId === row.id) setTypeId(""); if (filterType === row.id) setFilterType(""); }
      if (editing?.id === row.id) setEditing(null);
      setInfo("ลบแล้ว กลุ่มและโพสต์ยังอยู่"); await load();
    });
  }
  function patch(group: Group, data: Record<string, unknown>) {
    void run(async () => { await api(`/api/sources/${group.id}`, { method: "PATCH", body: JSON.stringify(data) }); setInfo(`บันทึก “${group.name}” แล้ว`); await load(); });
  }
  function removeGroup(group: Group) {
    if (!confirm(`ลบกลุ่ม “${group.name}” และโพสต์ที่เก็บจากกลุ่มนี้ทั้งหมด (${group.postCount} โพสต์)? การกระทำนี้ย้อนกลับไม่ได้`)) return;
    void run(async () => {
      await api(`/api/sources/${group.id}`, { method: "DELETE" });
      setInfo(`ลบกลุ่ม “${group.name}” แล้ว`);
      await load();
    });
  }
  const known = new Set(categories.map(row => row.slug));
  const visible = groups.filter(row => (!filter || (filter === "__unassigned" ? !known.has(row.boundCategorySlug) : row.boundCategorySlug === filter)) && (!filterType || (filterType === "__unassigned" ? !row.defaultProductId : row.defaultProductId === filterType)) && `${row.name} ${row.url}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const actions = (kind: "category" | "type", row: { id: string; name: string; slug?: string }) => managing ? <div className="mt-1 flex gap-2"><Button size="sm" variant="ghost" disabled={busy} aria-label={`แก้ชื่อ ${row.name}`} onClick={() => setEditing({ kind, id: row.id, name: row.name })}>แก้ชื่อ</Button><Button size="sm" variant="danger" disabled={busy} aria-label={`ลบ ${row.name}`} onClick={() => remove(kind, row)}>ลบ</Button></div> : null;
  return <div className="space-y-6">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-semibold">จัดการกลุ่ม</h1><p className="mt-1 text-sm text-muted">จัดกลุ่มตามหมวดหมู่และประเภท เช่น เกม / Roblox หรือ ไอที / มือถือ</p></div><Link href="/sources" className="text-sm text-pine underline">รอบอ่านและสถานะแหล่งข้อมูล</Link></div>
    {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}{info ? <p role="status" className="rounded-lg bg-pine/10 p-3 text-sm text-pine">{info}</p> : null}
    <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">หมวดหมู่</h2><Button size="sm" variant="outline" aria-expanded={managing} disabled={busy || loading} onClick={() => setManaging(value => !value)}>{managing ? "เสร็จแล้ว" : "จัดการ"}</Button></div>
        <nav aria-label="หมวดหมู่และประเภท" className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
          <Button variant={filter === "" ? "pine" : "ghost"} className="w-full justify-between" onClick={() => { setFilter(""); setFilterType(""); }}>ทั้งหมด <span>{groups.length}</span></Button>
          {categories.map(row => <div key={row.id} className="border-t border-line pt-2">
            <button type="button" aria-pressed={filter === row.slug && !filterType} className={`flex w-full justify-between gap-2 rounded-lg p-2 text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pine ${filter === row.slug && !filterType ? "bg-pine/10 text-pine" : "hover:bg-black/5"}`} onClick={() => { setFilter(row.slug); setFilterType(""); setTypeCategory(row.slug); }}><span className="break-all">{row.name}</span><span>{groups.filter(group => group.boundCategorySlug === row.slug).length}</span></button>
            {actions("category", row)}
            <div className="ml-3 border-l border-line pl-2">{types.filter(type => type.categorySlug === row.slug).map(type => <div key={type.id} className="py-1"><button type="button" aria-pressed={filterType === type.id} className={`flex w-full justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-pine ${filterType === type.id ? "bg-pine text-white" : "hover:bg-pine/5"}`} onClick={() => { setFilter(row.slug); setFilterType(type.id); }}><span className="break-all">{type.name}{!type.enabled ? " (ปิด)" : ""}</span><span>{groups.filter(group => group.defaultProductId === type.id && group.boundCategorySlug === row.slug).length}</span></button>{actions("type", type)}</div>)}{!types.some(type => type.categorySlug === row.slug) ? <p className="py-2 text-xs text-muted">ยังไม่มีประเภท</p> : null}</div>
          </div>)}
          <Button variant={filter === "__unassigned" ? "pine" : "ghost"} className="w-full justify-start" onClick={() => { setFilter("__unassigned"); setFilterType(""); }}>ยังไม่จัดหมวดหมู่</Button>
        </nav>
        {editing ? <form onSubmit={rename} className="space-y-2 border-t border-line pt-3"><Label htmlFor="taxonomy-rename">แก้ชื่อ{editing.kind === "category" ? "หมวดหมู่" : "ประเภท"}</Label><Input id="taxonomy-rename" autoFocus required maxLength={80} disabled={busy} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /><div className="flex gap-2"><Button size="sm" disabled={busy} type="submit">บันทึก</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>ยกเลิก</Button></div></form> : null}
        <form onSubmit={createCategory} className="space-y-2 border-t border-line pt-3"><Label htmlFor="category-name">สร้างหมวดหมู่</Label><Input id="category-name" required maxLength={80} value={categoryName} onChange={event => setCategoryName(event.target.value)} placeholder="เช่น เกม ไอที อาหาร" /><Button type="submit" variant="outline" disabled={busy || loading} className="w-full">สร้างหมวดหมู่</Button></form>
        <form onSubmit={createType} className="space-y-2 border-t border-line pt-3"><h3 className="text-sm font-semibold">สร้างประเภทภายใต้หมวดหมู่</h3><Label htmlFor="type-category">หมวดหมู่ของประเภท</Label><Select id="type-category" required value={typeCategory} onChange={event => setTypeCategory(event.target.value)}><option value="">เลือกหมวดหมู่</option>{categories.map(row => <option key={row.id} value={row.slug}>{row.name}</option>)}</Select><Label htmlFor="type-name">ชื่อประเภท</Label><Input id="type-name" required maxLength={80} value={typeName} onChange={event => setTypeName(event.target.value)} placeholder="เช่น Roblox, ROV หรือ มือถือ" /><Button type="submit" variant="pine" disabled={busy || loading || !typeCategory} className="w-full">สร้างประเภท</Button></form>
      </Card>
      <div className="min-w-0 space-y-5">
        <Card className="border-t-4 border-t-pine"><h2 className="text-lg font-semibold">เพิ่มกลุ่ม Facebook</h2><form onSubmit={addGroups} className="mt-4 space-y-3"><GroupTaxonomyFields id="add-group" categories={categories} types={types} categorySlug={category} typeId={typeId} disabled={busy || loading} required onChange={(cat, type) => { setCategory(cat); setTypeId(type); }} /><div><Label htmlFor="group-urls">ลิงก์กลุ่ม</Label><Textarea id="group-urls" required value={urls} onChange={event => setUrls(event.target.value)} placeholder={"https://www.facebook.com/groups/123456\nวางได้หลายลิงก์ บรรทัดละหนึ่งกลุ่ม"} /></div><div><Label htmlFor="group-name">ชื่อกลุ่ม (ใช้เมื่อเพิ่มทีละกลุ่ม)</Label><Input id="group-name" maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="ไม่จำเป็น ระบบตั้งชื่อจากลิงก์ให้ก่อน" /></div><Button variant="pine" type="submit" disabled={busy || loading || !category || !typeId}>{busy ? "กำลังบันทึก..." : "เพิ่มกลุ่ม"}</Button></form><p className="mt-3 text-xs leading-5 text-muted">ใช้ส่วนขยายและบัญชี Facebook ที่เข้าถึงกลุ่มได้ กลุ่มใหม่เปิดอ่านตามรอบปกติ การเพิ่มกลุ่มไม่เปิดส่งคอมเมนต์</p></Card>
        <section aria-label="รายการกลุ่ม" className="space-y-3"><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">รายการกลุ่ม ({visible.length})</h2><Input aria-label="ค้นหาชื่อหรือลิงก์กลุ่ม" className="sm:max-w-xs" value={search} onChange={event => setSearch(event.target.value)} placeholder="ค้นหาชื่อหรือลิงก์" /></div>
          <Select aria-label="กรองกลุ่มที่ยังไม่เลือกประเภท" value={filterType} onChange={event => setFilterType(event.target.value)}><option value="">ทุกประเภท</option><option value="__unassigned">ยังไม่เลือกประเภท</option>{types.filter(row => !filter || row.categorySlug === filter).map(row => <option key={row.id} value={row.id}>{categories.find(cat => cat.slug === row.categorySlug)?.name} / {row.name}</option>)}</Select>
          {loading ? <p role="status" className="py-6 text-sm text-muted">กำลังโหลด...</p> : !visible.length ? <Card><p className="py-4 text-sm text-muted">{groups.length ? "ไม่พบกลุ่มตามตัวกรอง ลองเลือกหมวดหมู่หรือประเภทอื่น" : "ยังไม่มีกลุ่ม สร้างหมวดหมู่และประเภท แล้ววางลิงก์เพื่อเริ่มต้น"}</p></Card> : visible.map(group => <Card key={group.id}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="break-all font-semibold">{group.name}</h3><Badge tone={group.enabled ? "pine" : "neutral"}>{group.enabled ? "เปิดอ่าน" : "พักอ่าน"}</Badge>{!group.defaultProductId ? <Badge tone="amber">ยังไม่เลือกประเภท</Badge> : null}</div><a href={group.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-pine underline">{group.url}</a><p className="mt-2 text-xs text-muted">เก็บแล้ว {group.postCount} โพสต์</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => patch(group, { enabled: !group.enabled })}>{group.enabled ? "พักอ่าน" : "เปิดอ่าน"}</Button></div>
            <div className="mt-4"><GroupPlacement key={`${group.boundCategorySlug}-${group.defaultProductId}`} group={group} categories={categories} types={types} disabled={busy} onSave={(cat, type) => patch(group, { boundCategorySlug: cat, defaultProductId: type || null })} /></div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => { const next = prompt("ชื่อกลุ่ม", group.name); if (next?.trim() && next.trim() !== group.name) patch(group, { name: next.trim() }); }}>แก้ไขชื่อกลุ่ม</Button>
              <Button variant="danger" size="sm" disabled={busy} aria-label={`ลบกลุ่ม ${group.name}`} onClick={() => removeGroup(group)}>ลบกลุ่ม</Button>
            </div>
          </Card>)}
        </section>
      </div>
    </div>
  </div>;
}

function GroupPlacement({ group, categories, types, disabled, onSave }: { group: Group; categories: GroupCategory[]; types: GroupType[]; disabled: boolean; onSave: (category: string, type: string) => void }) {
  const [category, setCategory] = useState(group.boundCategorySlug);
  const [typeId, setTypeId] = useState(group.defaultProductId ?? "");
  const dirty = category !== group.boundCategorySlug || typeId !== (group.defaultProductId ?? "");
  return <form className="space-y-2" onSubmit={event => { event.preventDefault(); onSave(category, typeId); }}><GroupTaxonomyFields id={`group-${group.id}`} categories={categories} types={types} categorySlug={category} typeId={typeId} required disabled={disabled} onChange={(cat, type) => { setCategory(cat); setTypeId(type); }} />{dirty ? <Button type="submit" size="sm" disabled={disabled || !category || !typeId}>บันทึกหมวดหมู่และประเภท</Button> : null}</form>;
}
