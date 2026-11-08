"use client";

import { Label, Select } from "@/components/ui";

export type GroupCategory = { id: string; slug: string; name: string; parentId: string | null };
export type GroupType = { id: string; name: string; categorySlug: string; enabled: boolean };

export function GroupTaxonomyFields({ id, categories, types, categorySlug, typeId, onChange, disabled, required = false, allowCategoryOnly = false }: {
  id: string; categories: GroupCategory[]; types: GroupType[]; categorySlug: string; typeId: string;
  onChange: (categorySlug: string, typeId: string) => void; disabled?: boolean; required?: boolean; allowCategoryOnly?: boolean;
}) {
  const choices = types.filter(row => row.categorySlug === categorySlug && (row.enabled || row.id === typeId));
  return <div className="grid gap-3 sm:grid-cols-2">
    <div><Label htmlFor={`${id}-category`}>หมวดหมู่</Label><Select id={`${id}-category`} value={categorySlug} disabled={disabled} required={required} onChange={event => onChange(event.target.value, "")}><option value="">เลือกหมวดหมู่</option>{categories.map(row => <option key={row.id} value={row.slug}>{row.name}</option>)}</Select></div>
    <div><Label htmlFor={`${id}-type`}>ประเภท</Label><Select id={`${id}-type`} value={typeId} disabled={disabled || !categorySlug} required={required && !allowCategoryOnly} onChange={event => onChange(categorySlug, event.target.value)}><option value="">{allowCategoryOnly ? "ทุกประเภทในหมวดหมู่" : "เลือกประเภท"}</option>{choices.map(row => <option key={row.id} value={row.id}>{row.name}{!row.enabled ? " (ปิดใช้งาน)" : ""}</option>)}</Select>{categorySlug && !choices.length ? <p className="mt-1 text-xs text-muted">ยังไม่มีประเภทในหมวดหมู่นี้ สร้างประเภทก่อนเลือก</p> : null}</div>
  </div>;
}
