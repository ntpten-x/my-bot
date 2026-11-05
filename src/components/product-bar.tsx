"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui";
import { api } from "@/components/api";
import type { CategoryRow } from "@/lib/lead";
import type { ProductRow } from "@/components/products-editor";

type State = { products: ProductRow[]; counts: Record<string, number>; followed: string[] };

/** Shared data for the product tabs and the followed sidebar (bot-w style). */
export function useProductBar(categoryId: string) {
  const [state, setState] = useState<State>({ products: [], counts: {}, followed: [] });
  useEffect(() => {
    const query = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : "";
    Promise.all([
      api<{ products: ProductRow[] }>("/api/products"),
      api<{ counts: Record<string, number> }>(`/api/products/counts${query}`),
      api<{ ids: string[] }>("/api/products/follow"),
    ])
      .then(([p, c, f]) => setState({ products: p.products.filter((item) => item.enabled), counts: c.counts, followed: f.ids }))
      .catch(() => undefined);
  }, [categoryId]);
  async function toggleFollow(id: string) {
    const ids = state.followed.includes(id) ? state.followed.filter((item) => item !== id) : [...state.followed, id];
    setState((current) => ({ ...current, followed: ids }));
    await api("/api/products/follow", { method: "PUT", body: JSON.stringify({ ids }) }).catch(() => undefined);
  }
  return { ...state, toggleFollow };
}

type Bar = ReturnType<typeof useProductBar>;

function Tab({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-3 py-1 text-sm ${active ? "border-clay bg-clay text-white" : "border-line bg-card hover:bg-paper"}`}
    >
      {label}
      {count !== undefined ? <span className={active ? "ml-1 text-white/80" : "ml-1 text-muted"}>{count}</span> : null}
    </button>
  );
}

/** Tab bar: ทั้งหมด · followed + busiest products · ไม่ระบุ, plus a “เลือกหมวด” picker grouped by category. */
export function ProductTabs({ bar, categories, value, onChange }: { bar: Bar; categories: CategoryRow[]; value: string; onChange: (productId: string) => void }) {
  const counted = bar.products.filter((item) => bar.counts[item.id]);
  const top = [...counted].sort((a, b) => (bar.counts[b.id] ?? 0) - (bar.counts[a.id] ?? 0));
  const shown = [...bar.products.filter((item) => bar.followed.includes(item.id)), ...top].filter((item, index, list) => list.findIndex((row) => row.id === item.id) === index).slice(0, 12);
  const selected = bar.products.find((item) => item.id === value);
  if (selected && !shown.includes(selected)) shown.push(selected);
  const all = Object.values(bar.counts).reduce((sum, count) => sum + count, 0);
  const parents = categories.filter((item) => !item.parentId);
  const groups = [...new Set(bar.products.map((item) => item.categorySlug))];
  if (!bar.products.length) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
        <Tab active={!value} label="ทั้งหมด" count={all} onClick={() => onChange("")} />
        {shown.map((item) => (
          <Tab key={item.id} active={value === item.id} label={`${bar.followed.includes(item.id) ? "★ " : ""}${item.name}`} count={bar.counts[item.id] ?? 0} onClick={() => onChange(item.id)} />
        ))}
        <Tab active={value === "none"} label="ไม่ระบุ" count={bar.counts.none ?? 0} onClick={() => onChange("none")} />
      </div>
      <Select className="w-auto" aria-label="เลือกหมวด" value={selected ? selected.id : ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">เลือกหมวด…</option>
        {groups.map((slug) => (
          <optgroup key={slug} label={parents.find((item) => item.slug === slug)?.name ?? slug}>
            {bar.products.filter((item) => item.categorySlug === slug).map((item) => (
              <option key={item.id} value={item.id}>{item.name} ({bar.counts[item.id] ?? 0})</option>
            ))}
          </optgroup>
        ))}
      </Select>
      {selected ? (
        <button type="button" className="text-sm text-clay" onClick={() => void bar.toggleFollow(selected.id)}>
          {bar.followed.includes(selected.id) ? "★ เลิกติดตาม" : "☆ ติดตาม"}
        </button>
      ) : null}
    </div>
  );
}

/** “หมวดที่คุณติดตาม” sidebar. */
export function FollowedProducts({ bar, value, onChange }: { bar: Bar; value: string; onChange: (productId: string) => void }) {
  const followed = bar.products.filter((item) => bar.followed.includes(item.id));
  return (
    <aside className="rounded-2xl border border-line bg-card p-3 text-sm lg:sticky lg:top-4">
      <h2 className="font-semibold">หมวดที่คุณติดตาม</h2>
      {followed.length ? (
        <ul className="mt-2 space-y-1">
          {followed.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <button type="button" className={`text-left ${value === item.id ? "font-semibold text-clay" : ""}`} onClick={() => onChange(item.id)}>
                {item.name}
              </button>
              <span className="flex items-center gap-2 text-muted">
                {bar.counts[item.id] ?? 0}
                <button type="button" aria-label={`เลิกติดตาม ${item.name}`} onClick={() => void bar.toggleFollow(item.id)}>★</button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted">เลือกเกม/สินค้าจาก “เลือกหมวด” แล้วกด ☆ ติดตาม</p>
      )}
    </aside>
  );
}
