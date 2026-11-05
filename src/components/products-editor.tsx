"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import type { CategoryRow } from "@/lib/lead";

export type ProductRow = { id: string; slug: string; name: string; nameEn: string; categorySlug: string; aliases: string[]; enabled: boolean; sortOrder: number };

/** Level 3 (bot-w style): category → game/product with aliases the rules match on. */
export function ProductsEditor({ categories }: { categories: CategoryRow[] }) {
  const parents = categories.filter((item) => !item.parentId);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [categorySlug, setCategorySlug] = useState("games");
  const [aliases, setAliases] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setProducts((await api<{ products: ProductRow[] }>("/api/products")).products);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "โหลดเกม/สินค้าไม่สำเร็จ");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/products", { method: "POST", body: JSON.stringify({ name, nameEn, categorySlug, aliases }) });
      setName("");
      setNameEn("");
      setAliases("");
      setError("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เพิ่มไม่สำเร็จ");
    }
  }

  const nameOf = new Map(parents.map((item) => [item.slug, item.name]));
  const groups = [...new Set(products.map((item) => item.categorySlug))];

  return (
    <Card className="mt-4">
      <h2 className="font-semibold">เกม / สินค้า (ระดับ 3)</h2>
      <p className="mt-1 text-sm text-muted">
        ระบบจับชื่อเรียก (alias) ในโพสต์ก่อน แล้วให้ AI เลือกจากรายการนี้เท่านั้น ถ้าไม่ชัดใช้ค่าเริ่มต้นของกลุ่ม ไม่งั้นเป็น “ไม่ระบุ”
      </p>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <form onSubmit={add} className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_160px_2fr_auto]">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="ชื่อ (ไทย) เช่น โรบล็อกซ์" required />
        <Input value={nameEn} onChange={(event) => setNameEn(event.target.value)} placeholder="ชื่ออังกฤษ" />
        <Select value={categorySlug} onChange={(event) => setCategorySlug(event.target.value)} aria-label="หมวดหลัก">
          {parents.map((item) => (
            <option key={item.id} value={item.slug}>{item.name}</option>
          ))}
        </Select>
        <Input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="ชื่อเรียก คั่นด้วยจุลภาค เช่น roblox, robux, โรบัค" />
        <Button type="submit">เพิ่ม</Button>
      </form>
      <div className="mt-4 space-y-3">
        {groups.map((slug) => (
          <div key={slug} className="rounded-xl bg-paper p-3">
            <h3 className="text-sm font-medium">{nameOf.get(slug) ?? slug}</h3>
            <div className="mt-2 space-y-2">
              {products.filter((item) => item.categorySlug === slug).map((item) => (
                <ProductLine key={`${item.id}-${item.aliases.join()}-${item.enabled}`} product={item} onSaved={load} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ProductLine({ product, onSaved }: { product: ProductRow; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(product.name);
  const [aliases, setAliases] = useState(product.aliases.join(", "));
  async function save(body: Record<string, unknown>) {
    await api(`/api/products/${product.id}`, { method: "PATCH", body: JSON.stringify(body) });
    await onSaved();
  }
  return (
    <form
      className={`grid gap-2 md:grid-cols-[1fr_2.4fr_auto_auto] ${product.enabled ? "" : "opacity-60"}`}
      onSubmit={(event) => {
        event.preventDefault();
        void save({ name, aliases });
      }}
    >
      <Input value={name} onChange={(event) => setName(event.target.value)} aria-label={`ชื่อ ${product.slug}`} />
      <Input value={aliases} onChange={(event) => setAliases(event.target.value)} aria-label={`ชื่อเรียก ${product.slug}`} />
      <Button type="submit" size="sm" variant="outline">บันทึก</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => void save({ enabled: !product.enabled })}>
        {product.enabled ? "ปิด" : "เปิด"}
      </Button>
    </form>
  );
}
