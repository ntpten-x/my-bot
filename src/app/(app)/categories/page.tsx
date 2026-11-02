"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import type { CategoryRow } from "@/lib/lead";

type Keyword = { id: string; word: string; type: "watch" | "forbidden" };

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [word, setWord] = useState("");
  const [type, setType] = useState<"watch" | "forbidden">("watch");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [categoryData, keywordData] = await Promise.all([
        api<{ categories: CategoryRow[] }>("/api/categories"),
        api<{ keywords: Keyword[] }>("/api/keywords"),
      ]);
      setCategories(categoryData.categories);
      setKeywords(keywordData.keywords);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    await api("/api/categories", { method: "POST", body: JSON.stringify({ name, parentId: parentId || null }) });
    setName("");
    await load();
  }

  async function addKeyword(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/keywords", { method: "POST", body: JSON.stringify({ word, type }) });
      setWord("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เพิ่มคำไม่สำเร็จ");
    }
  }

  const parents = categories.filter((item) => !item.parentId);

  return (
    <div>
      <h1 className="text-2xl font-semibold">หมวดและคีย์เวิร์ด</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
        หมวดใช้จัดประกาศ คำในช่อง “คำจับคู่” ช่วยตัวคัดสำรองเมื่อไม่มี AI คำเฝ้าดูใช้ไฮไลต์และยิงการแจ้งเตือน คำต้องห้ามจะถูกซ่อนจากฟีดเริ่มต้น
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="mt-4 text-sm text-muted">กำลังโหลด...</p> : null}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">หมวด</h2>
          <form onSubmit={addCategory} className="mt-3 grid gap-2">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="ชื่อหมวดใหม่" />
            <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">เป็นหมวดหลัก</option>
              {parents.map((item) => (
                <option key={item.id} value={item.id}>ย่อยของ {item.name}</option>
              ))}
            </Select>
            <Button type="submit">เพิ่มหมวด</Button>
          </form>
          <div className="mt-4 space-y-3">
            {parents.map((parent) => (
              <div key={parent.id} className="rounded-xl bg-paper p-3">
                <CategoryEditor category={parent} onSaved={load} />
                <div className="mt-2 space-y-2 pl-3">
                  {categories.filter((item) => item.parentId === parent.id).map((child) => (
                    <CategoryEditor key={child.id} category={child} onSaved={load} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="font-semibold">คีย์เวิร์ด</h2>
          <form onSubmit={addKeyword} className="mt-3 grid gap-2 md:grid-cols-[1fr_140px_auto]">
            <Input value={word} onChange={(event) => setWord(event.target.value)} placeholder="เช่น รับซื้อ" />
            <Select value={type} onChange={(event) => setType(event.target.value as "watch" | "forbidden")}>
              <option value="watch">คำเฝ้าดู</option>
              <option value="forbidden">คำต้องห้าม</option>
            </Select>
            <Button type="submit">เพิ่ม</Button>
          </form>
          {(["watch", "forbidden"] as const).map((kind) => (
            <div key={kind} className="mt-4">
              <h3 className="text-sm font-medium">{kind === "watch" ? "คำเฝ้าดู" : "คำต้องห้าม"}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {keywords.filter((item) => item.type === kind).map((item) => (
                  <button
                    key={item.id}
                    className="rounded-full border border-line bg-card px-3 py-1 text-sm"
                    onClick={() => api(`/api/keywords/${item.id}`, { method: "DELETE" }).then(load)}
                    title="คลิกเพื่อลบ"
                  >
                    {item.word} ×
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function CategoryEditor({ category, onSaved }: { category: CategoryRow; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(category.name);
  const [matchWords, setMatchWords] = useState(category.matchWords);
  return (
    <form
      className="grid gap-2 md:grid-cols-[1fr_1.4fr_auto_auto]"
      onSubmit={async (event) => {
        event.preventDefault();
        await api(`/api/categories/${category.id}`, { method: "PATCH", body: JSON.stringify({ name, matchWords }) });
        await onSaved();
      }}
    >
      <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="ชื่อหมวด" />
      <Input value={matchWords} onChange={(event) => setMatchWords(event.target.value)} aria-label="คำจับคู่" placeholder="คำจับคู่ คั่นด้วยจุลภาค" />
      <Button type="submit" size="sm" variant="outline">บันทึก</Button>
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => {
          if (confirm(`ลบหมวด ${category.name}?`)) void api(`/api/categories/${category.id}`, { method: "DELETE" }).then(onSaved);
        }}
      >
        ลบ
      </Button>
    </form>
  );
}
