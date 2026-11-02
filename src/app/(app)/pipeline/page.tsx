"use client";

import { useEffect, useState } from "react";
import { LeadCard } from "@/components/lead-card";
import { ApiError, api } from "@/components/api";
import { PIPELINE } from "@/lib/format";
import type { Lead } from "@/lib/lead";

export default function PipelinePage() {
  const [posts, setPosts] = useState<Lead[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ posts: Lead[] }>("/api/posts?pipeline=1&hideAds=0&hideForbidden=0&page=1")
      .then((data) => setPosts(data.posts))
      .catch((err) => setError(err instanceof ApiError ? err.message : "โหลดไปป์ไลน์ไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);

  function replace(next: Lead) {
    setPosts((current) => current.map((item) => (item.id === next.id ? next : item)).filter((item) => item.pipelineStatus !== "none"));
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">ไปป์ไลน์</h1>
      <p className="mt-1 text-sm text-muted">ติดตามลีดที่เก็บไว้ ตั้งแต่ทักจนปิดงาน พร้อมโน้ตส่วนตัว</p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="mt-6 text-sm text-muted">กำลังโหลด...</p> : null}
      {!loading && !posts.length ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-card p-8 text-sm text-muted">
          ยังไม่มีลีดในไปป์ไลน์ กด “เก็บเข้าไปป์ไลน์” จากฟีดได้เลย
        </div>
      ) : null}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {PIPELINE.map((column) => (
          <section key={column.id}>
            <h2 className="mb-3 font-semibold">{column.label}</h2>
            <div className="space-y-3">
              {posts.filter((post) => post.pipelineStatus === column.id).map((lead) => (
                <LeadCard key={lead.id} lead={lead} highlights={lead.keywordHits} onChange={replace} showNotes />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
