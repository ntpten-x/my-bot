"use client";

import { Select } from "@/components/ui";
import type { CategoryRow } from "@/lib/lead";
import type { ProductRow } from "@/components/products-editor";

export type Binding = {
  sourceId: string;
  boundCategorySlug: string;
  defaultProductId: string | null;
  suggestedCategory: { slug: string; share: number } | null;
  suggestedProduct: { slug: string; name: string; share: number } | null;
  posts30d: number;
  productCoverage: number;
};

/** Per-group binding: main category + default game/product (auto from the last 30 days unless the owner picks). */
export function SourceBinding({
  binding,
  categories,
  products,
  onSave,
}: {
  binding: Binding;
  categories: CategoryRow[];
  products: ProductRow[];
  onSave: (body: { boundCategorySlug?: string; defaultProductId?: string | null }) => void;
}) {
  const parents = categories.filter((item) => !item.parentId);
  const nameOf = new Map(parents.map((item) => [item.slug, item.name]));
  const autoCat = binding.suggestedCategory && !binding.boundCategorySlug ? `${nameOf.get(binding.suggestedCategory.slug) ?? binding.suggestedCategory.slug} ${Math.round(binding.suggestedCategory.share * 100)}%` : "ยังไม่พอ";
  const autoProduct = binding.suggestedProduct ? `${binding.suggestedProduct.name} ${Math.round(binding.suggestedProduct.share * 100)}%` : "ยังไม่พอ";
  const category = binding.boundCategorySlug || binding.suggestedCategory?.slug || "";
  const choices = products.filter((item) => item.enabled && (!category || item.categorySlug === category));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">หมวดกลุ่ม</span>
      <Select className="w-auto" aria-label="หมวดของกลุ่ม" value={binding.boundCategorySlug} onChange={(event) => onSave({ boundCategorySlug: event.target.value, defaultProductId: null })}>
        <option value="">อัตโนมัติ ({autoCat})</option>
        {parents.map((item) => (
          <option key={item.id} value={item.slug}>{item.name}</option>
        ))}
      </Select>
      <span className="text-muted">เกม/สินค้าหลัก</span>
      <Select className="w-auto" aria-label="เกม/สินค้าหลักของกลุ่ม" value={binding.defaultProductId ?? ""} onChange={(event) => onSave({ defaultProductId: event.target.value || null, ...(event.target.value ? { boundCategorySlug: products.find(item => item.id === event.target.value)?.categorySlug ?? category } : {}) })}>
        <option value="">อัตโนมัติ ({autoProduct})</option>
        {choices.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </Select>
      <span className="text-xs text-muted">ระบุเกม/สินค้าได้ {Math.round(binding.productCoverage * 100)}% ของ {binding.posts30d} โพสต์ (30 วัน)</span>
    </div>
  );
}
