"use client";

import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { ApiError, api } from "@/components/api";

type Suggestion = { word: string; support: number };

export default function LearnPage() {
  const [watch, setWatch] = useState<Suggestion[]>([]);
  const [forbidden, setForbidden] = useState<Suggestion[]>([]);
  const [counts, setCounts] = useState({ liked: 0, disliked: 0 });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function load() {
    const data = await api<{ suggestions: { watch: Suggestion[]; forbidden: Suggestion[] }; liked: number; disliked: number }>("/api/learn");
    setWatch(data.suggestions.watch);
    setForbidden(data.suggestions.forbidden);
    setCounts({ liked: data.liked, disliked: data.disliked });
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : "โหลดไม่สำเร็จ"));
  }, []);

  async function add(word: string, type: "watch" | "forbidden") {
    setInfo("");
    try {
      await api("/api/keywords", { method: "POST", body: JSON.stringify({ word, type }) });
      setInfo(`เพิ่ม “${word}” แล้ว`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "เพิ่มคำไม่สำเร็จ");
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">เรียนรู้จากที่คุณเลือก</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
        ระบบจำจากปุ่มไม่สนใจ บันทึก ทักแล้ว และปิดการขาย แล้วเสนอคำเฝ้าดูหรือคำต้องห้ามจากโพสต์เหล่านั้น กดคำเพื่อเพิ่มได้ทันที ตอนนี้มีตัวอย่างที่สนใจ {counts.liked} และที่ไม่เอา {counts.disliked}
      </p>
      {info ? <p className="mt-3 text-sm text-pine">{info}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold">คำเฝ้าดูที่น่าเพิ่ม</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {watch.length ? watch.map((item) => (
              <Button key={item.word} size="sm" variant="outline" onClick={() => add(item.word, "watch")}>
                {item.word} · {item.support}
              </Button>
            )) : <p className="text-sm text-muted">ยังไม่พอจะเสนอ ลองบันทึกหรือทักลีดที่ชอบอย่างน้อยสองโพสต์ที่ใช้คำคล้ายกัน</p>}
          </div>
        </Card>
        <Card>
          <h2 className="font-semibold">คำต้องห้ามที่น่าเพิ่ม</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {forbidden.length ? forbidden.map((item) => (
              <Button key={item.word} size="sm" variant="danger" onClick={() => add(item.word, "forbidden")}>
                {item.word} · {item.support}
              </Button>
            )) : <p className="text-sm text-muted">ยังไม่มีคำจากโพสต์ที่กดไม่สนใจหรือปิดไม่สำเร็จ</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
