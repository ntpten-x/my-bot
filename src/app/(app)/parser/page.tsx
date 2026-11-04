"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import { timeAgo } from "@/lib/format";

type SamplePost = { url: string; authorName: string; text: string; postedAt: string | null; imageCount: number };
type Sample = { id: string; sourceUrl: string; postCount: number; createdAt: string; posts: SamplePost[] };

export default function ParserPage() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ samples: Sample[] }>("/api/parser-sample")
      .then((data) => setSamples(data.samples))
      .catch((err) => setError(err instanceof ApiError ? err.message : "โหลดตัวอย่างไม่สำเร็จ"));
  }, []);

  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold">ทดสอบตัวอ่านโพสต์</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
        ส่วนขยายส่งตัวอย่างที่อ่านได้จากหน้ากลุ่มล่าสุดมาไว้ที่นี่ ถ้าเปิดกลุ่มแล้วยังว่าง แปลว่าตัวเลือกในหน้า Facebook เปลี่ยน หรือยังไม่ได้ใส่โทเคน
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {!error && !samples.length ? <p className="mt-6 text-sm text-muted">ยังไม่มีตัวอย่างจากการอ่านหน้ากลุ่ม</p> : null}
      <div className="mt-4 space-y-4">
        {samples.map((sample) => (
          <Card key={sample.id}>
            <div className="break-all text-sm text-muted">
              {timeAgo(sample.createdAt)} · อ่านได้ {sample.postCount} โพสต์ · {sample.sourceUrl}
            </div>
            <div className="mt-3 space-y-3">
              {sample.posts.map((post, index) => (
                <article key={`${post.url}-${index}`} className="min-w-0 rounded-xl bg-paper px-3 py-2 text-sm">
                  <div className="font-medium">{post.authorName || "ไม่ทราบชื่อ"}</div>
                  <p className="mt-1 whitespace-pre-wrap break-words leading-6">{post.text || "(ไม่มีข้อความ)"}</p>
                  <div className="mt-1 break-all text-xs text-muted">
                    {post.postedAt || "ไม่มีเวลา"} · รูป {post.imageCount}
                    {post.url ? ` · ${post.url}` : ""}
                  </div>
                </article>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
