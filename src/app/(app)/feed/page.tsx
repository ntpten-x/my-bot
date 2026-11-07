"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { LeadCard } from "@/components/lead-card";
import { ApiError, api } from "@/components/api";
import { bangkokStart } from "@/lib/format";
import { FollowedProducts, ProductTabs, useProductBar } from "@/components/product-bar";
import type { CategoryRow, Lead } from "@/lib/lead";

type Meta = {
  categories: CategoryRow[];
  sources: { id: string; name: string }[];
  keywords: { word: string; type: string }[];
  provinces: string[];
};

type Filters = {
  q: string;
  categoryId: string;
  subcategoryId: string;
  productId: string;
  province: string;
  sourceId: string;
  intent: string;
  range: string;
  unread: boolean;
  saved: boolean;
  hideAds: boolean;
  hideForbidden: boolean;
  hideDuplicates: boolean;
  sort: string;
  minScore: string;
  semantic: boolean;
  area: boolean;
  hideInactiveSources: boolean;
  followedOnly: boolean;
};

const INITIAL: Filters = {
  q: "",
  categoryId: "",
  subcategoryId: "",
  productId: "",
  province: "",
  sourceId: "",
  intent: "",
  range: "all",
  unread: false,
  saved: false,
  hideAds: true,
  hideForbidden: true,
  hideDuplicates: true,
  sort: "score",
  minScore: "",
  semantic: false,
  area: false,
  hideInactiveSources: true,
  followedOnly: true,
};

const PAGE_SIZE = 20;

function readUrl(): { filters: Filters; page: number } {
  if (typeof window === "undefined") return { filters: INITIAL, page: 1 };
  const params = new URLSearchParams(window.location.search);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sort = params.get("sort");
  const filters = { ...INITIAL } as Record<string, unknown>;
  // Every filter lives in the address bar, so reload, back, and shared links keep the same view.
  for (const [key, fallback] of Object.entries(INITIAL)) {
    const value = params.get(key);
    if (value === null) continue;
    filters[key] = typeof fallback === "boolean" ? value === "1" : value;
  }
  const next = { ...(filters as Filters), sort: sort === "score" || sort === "captured" ? sort : INITIAL.sort };
  // Booleans that default to true are stored as 0 when off (same pattern as hideAds).
  if (params.get("hideInactiveSources") === "0") next.hideInactiveSources = false;
  if (params.get("followedOnly") === "0") next.followedOnly = false;
  if (params.get("followedOnly") === "1") next.followedOnly = true;
  return { filters: next, page };
}

function pageList(page: number, pages: number): (number | "...")[] {
  const out: (number | "...")[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) out.push(i);
    else if (out[out.length - 1] !== "...") out.push("...");
  }
  return out;
}

function queryFrom(filters: Filters, page: number) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));
  if (filters.q) params.set("q", filters.q);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.subcategoryId) params.set("subcategoryId", filters.subcategoryId);
  if (filters.productId) params.set("productId", filters.productId);
  if (filters.province) params.set("province", filters.province);
  if (filters.sourceId) params.set("sourceId", filters.sourceId);
  if (filters.intent) params.set("intent", filters.intent);
  if (filters.unread) params.set("unread", "1");
  if (filters.saved) params.set("saved", "1");
  if (!filters.hideAds) params.set("hideAds", "0");
  if (!filters.hideForbidden) params.set("hideForbidden", "0");
  if (!filters.hideDuplicates) params.set("hideDuplicates", "0");
  if (!filters.hideInactiveSources) params.set("hideInactiveSources", "0");
  if (!filters.followedOnly) params.set("followedOnly", "0");
  else params.set("followedOnly", "1");
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.minScore) params.set("minScore", filters.minScore);
  if (filters.semantic) params.set("semantic", "1");
  if (filters.area) params.set("area", "1");
  const days = filters.range === "today" ? 0 : filters.range === "3d" ? 3 : filters.range === "7d" ? 7 : filters.range === "30d" ? 30 : filters.range === "90d" ? 90 : null;
  if (days !== null) params.set("from", bangkokStart(days).toISOString());
  return params.toString();
}

function beep() {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 740;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.04, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
  osc.start();
  osc.stop(ctx.currentTime + 0.28);
}

export default function FeedPage() {
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const [draftQ, setDraftQ] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [posts, setPosts] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [searchScope, setSearchScope] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sound, setSound] = useState(true);

  const load = useCallback(async (nextPage: number, nextFilters: Filters) => {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ posts: Lead[]; total: number; searchScope?: string }>(`/api/posts?${queryFrom(nextFilters, nextPage)}`);
      setPosts(data.posts);
      setTotal(data.total);
      setSearchScope(data.searchScope ?? "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "โหลดฟีดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api<Meta>("/api/meta").then(setMeta).catch(() => undefined);
    api<{ settings: { notifySound: boolean } }>("/api/settings")
      .then((data) => setSound(data.settings.notifySound))
      .catch(() => undefined);
  }, []);

  const [ready, setReady] = useState(false);
  useEffect(() => {
    const initial = readUrl();
    setFilters(initial.filters);
    setDraftQ(initial.filters.q);
    setPage(initial.page);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(page));
    for (const [key, fallback] of Object.entries(INITIAL)) {
      const value = (filters as Record<string, unknown>)[key];
      if (value === fallback || value === undefined) url.searchParams.delete(key);
      else url.searchParams.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
    }
    window.history.replaceState(null, "", url.toString());
    void load(page, filters);
  }, [ready, page, filters, load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  function goto(next: number) {
    setPage(Math.min(Math.max(1, next), pages));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    const stream = new EventSource("/api/v1/stream");
    if (!ready) return;
    stream.onmessage = (event) => {
      const data = JSON.parse(event.data) as { type: string; posts?: Lead[] };
      if (data.type !== "posts" || !data.posts?.length) return;
      const interesting = data.posts.filter((post) => !post.isAd && !post.forbiddenHit && !post.duplicateOfId);
      if (sound && interesting.length) beep();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const post of interesting.slice(0, 2)) {
          new Notification("MY-BOT พบลีดใหม่", { body: post.text.slice(0, 140) });
        }
      }
      void load(page, filters);
    };
    return () => stream.close();
  }, [ready, filters, load, page, sound]);

  const parents = meta?.categories.filter((item) => !item.parentId) ?? [];
  const children = meta?.categories.filter((item) => item.parentId === filters.categoryId) ?? [];
  const highlights = [
    ...(meta?.keywords.filter((item) => item.type === "watch").map((item) => item.word) ?? []),
    filters.q,
  ];

  const bar = useProductBar(filters.categoryId);

  function update(partial: Partial<Filters>) {
    setPage(1);
    setFilters((current) => ({ ...current, ...partial }));
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">ฟีดลีด</h1>
          <p className="mt-1 text-sm text-muted">พบ {total} รายการ · หน้า {page}/{pages}</p>
          {searchScope ? <p className="mt-1 max-w-2xl text-sm text-muted" role="status">{searchScope}</p> : null}
        </div>
        <Button
          variant="outline"
          onClick={() => api("/api/posts/mark-read", { method: "POST", body: JSON.stringify({ ids: posts.map((post) => post.id) }) }).then(() => load(page, filters))}
        >
          อ่านรายการในหน้านี้แล้ว
        </Button>
      </div>
      <ProductTabs bar={bar} categories={meta?.categories ?? []} value={filters.productId} onChange={(productId) => update({ productId })} />
      <div className="lg:grid lg:grid-cols-[1fr_220px] lg:gap-4">
      <div className="min-w-0">
      <form
        className="mt-4 grid gap-2 md:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: draftQ });
        }}
      >
        <Input value={draftQ} onChange={(event) => setDraftQ(event.target.value)} placeholder="ค้นหาข้อความ ผู้เขียน จังหวัด" />
        <Select value={filters.categoryId} onChange={(event) => update({ categoryId: event.target.value, subcategoryId: "" })}>
          <option value="">ทุกหมวด</option>
          {parents.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </Select>
        <Select value={filters.subcategoryId} onChange={(event) => update({ subcategoryId: event.target.value })}>
          <option value="">ทุกหมวดย่อย</option>
          {children.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </Select>
        <Select value={filters.province} onChange={(event) => update({ province: event.target.value })}>
          <option value="">ทุกจังหวัด</option>
          {(meta?.provinces ?? []).map((province) => (
            <option key={province} value={province!}>{province}</option>
          ))}
        </Select>
        <Select value={filters.sourceId} onChange={(event) => update({ sourceId: event.target.value })}>
          <option value="">ทุกแหล่ง</option>
          {(meta?.sources ?? []).map((source) => (
            <option key={source.id} value={source.id}>{source.name}</option>
          ))}
        </Select>
        <Select value={filters.intent} onChange={(event) => update({ intent: event.target.value })}>
          <option value="">ทุกเจตนา</option>
          <option value="buyer">กำลังหา</option>
          <option value="seller">กำลังขาย</option>
          <option value="ad">โฆษณา</option>
          <option value="chat">พูดคุย/ถามทั่วไป</option>
          <option value="unknown">ไม่ชัด</option>
        </Select>
        <Select value={filters.sort} onChange={(event) => update({ sort: event.target.value })}>
          <option value="new">ล่าสุดก่อน (เวลาโพสต์)</option>
          <option value="captured">ล่าสุดก่อน (เวลาที่เก็บ)</option>
          <option value="score">เรียงตามคะแนน</option>
        </Select>
        <Input value={filters.minScore} onChange={(event) => update({ minScore: event.target.value })} placeholder="คะแนนขั้นต่ำ" />
        <Select value={filters.range} onChange={(event) => update({ range: event.target.value })}>
          <option value="all">ทุกช่วงเวลา</option>
          <option value="today">วันนี้</option>
          <option value="3d">3 วัน</option>
          <option value="7d">7 วัน</option>
          <option value="30d">30 วัน</option>
          <option value="90d">90 วัน</option>
        </Select>
        <Button type="submit">ค้นหา</Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={filters.unread} onChange={(event) => update({ unread: event.target.checked })} /> ยังไม่อ่าน</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={filters.saved} onChange={(event) => update({ saved: event.target.checked })} /> ที่บันทึก</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={filters.hideAds} onChange={(event) => update({ hideAds: event.target.checked })} /> ซ่อนโฆษณา</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={filters.hideForbidden} onChange={(event) => update({ hideForbidden: event.target.checked })} /> ซ่อนคำต้องห้าม</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={filters.hideDuplicates} onChange={(event) => update({ hideDuplicates: event.target.checked })} /> ยุบโพสต์คล้ายกัน</label>
        <label className="flex items-center gap-2" title="ซ่อนโพสต์จากแหล่งที่ปิดชั่วคราว เช่น มาร์เก็ตเพลสที่ไม่เฝ้าแล้ว"><input type="checkbox" checked={filters.hideInactiveSources} onChange={(event) => update({ hideInactiveSources: event.target.checked })} /> เฉพาะแหล่งที่เปิด</label>
        <label className="flex items-center gap-2" title="แสดงเฉพาะโพสต์ที่ติดดาว Roblox/PUBG ฯลฯ"><input type="checkbox" checked={filters.followedOnly} onChange={(event) => update({ followedOnly: event.target.checked })} /> เฉพาะที่ติดตาม</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={filters.semantic} onChange={(event) => update({ semantic: event.target.checked })} /> ค้นตามความหมาย</label>
        <label className="flex items-center gap-2" title="ตั้งจังหวัดได้ที่หน้า กฎอัตโนมัติ"><input type="checkbox" checked={filters.area} onChange={(event) => update({ area: event.target.checked })} /> เฉพาะพื้นที่ให้บริการ</label>
      </div>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="mt-6 text-sm text-muted">กำลังโหลดฟีด...</p> : null}
      {!loading && !posts.length ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-card p-8 text-center">
          <p className="font-medium">ยังไม่มีลีดในมุมนี้</p>
          <p className="mt-2 text-sm text-muted">ลองปลดตัวกรอง หรือเพิ่มกลุ่ม Facebook ในหน้าแหล่งข้อมูล แล้วเปิดส่วนขยายขณะล็อกอินเฟซบุ๊ก</p>
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        {posts.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            highlights={highlights}
            onChange={(next) => setPosts((current) => current.map((item) => (item.id === next.id ? next : item)))}
          />
        ))}
      </div>
      {pages > 1 ? (
        <nav className="mt-4 flex flex-wrap items-center justify-center gap-2" aria-label="เลือกหน้า">
          <Button variant="outline" disabled={page <= 1} onClick={() => goto(page - 1)}>ก่อนหน้า</Button>
          {pageList(page, pages).map((item, index) =>
            item === "..." ? (
              <span key={"gap" + index} className="px-1 text-sm text-muted">…</span>
            ) : (
              <Button key={item} variant={item === page ? undefined : "outline"} aria-current={item === page ? "page" : undefined} onClick={() => goto(item)}>{item}</Button>
            ),
          )}
          <Button variant="outline" disabled={page >= pages} onClick={() => goto(page + 1)}>ถัดไป</Button>
          <span className="text-sm text-muted">หน้า {page}/{pages}</span>
        </nav>
      ) : null}
      </div>
      <div className="mt-4">
        <FollowedProducts bar={bar} value={filters.productId} onChange={(productId) => update({ productId })} />
      </div>
      </div>
    </div>
  );
}
