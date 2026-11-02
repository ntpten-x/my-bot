"use client";

import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import { timeAgo } from "@/lib/format";

type Row = { id: string; day: string; title: string; body: string; createdAt: string };

export default function SummariesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function load() {
    const data = await api<{ summaries: Row[] }>("/api/summaries");
    setRows(data.summaries);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : "โหลดสรุปไม่สำเร็จ"));
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">สรุปรายวัน</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            ทุกเช้าตามเวลาในหน้าตั้งค่า ระบบสรุปจำนวนลีดเมื่อวาน ลีดร้อน หมวดและคำที่มาแรง และกลุ่มที่ดีที่สุดกับแผ่วที่สุด ส่งในแอป และไป LINE หรือ Discord ถ้าตั้งไว้
          </p>
        </div>
        <Button
          onClick={async () => {
            setError("");
            try {
              await api("/api/summaries/send", { method: "POST" });
              setInfo("ส่งสรุปของเมื่อวานแล้ว");
              await load();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "ส่งไม่สำเร็จ");
            }
          }}
        >
          ส่งตอนนี้
        </Button>
      </div>
      {info ? <p className="mt-3 text-sm text-pine">{info}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-4 space-y-3">
        {rows.length ? rows.map((row) => (
          <Card key={row.id}>
            <div className="flex justify-between gap-3 text-sm">
              <strong>{row.title}</strong>
              <span className="text-muted">{timeAgo(row.createdAt)}</span>
            </div>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6">{row.body}</pre>
          </Card>
        )) : <p className="mt-6 text-sm text-muted">ยังไม่มีสรุป กดส่งตอนนี้เพื่อดูของเมื่อวาน</p>}
      </div>
    </div>
  );
}
