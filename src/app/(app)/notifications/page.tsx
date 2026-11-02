"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import { timeAgo } from "@/lib/format";

type Item = {
  id: string;
  channel: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

const CHANNEL: Record<string, string> = {
  in_app: "ในแอป",
  line: "LINE",
  discord: "Discord",
  email: "อีเมล",
};

export default function NotificationsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [permission, setPermission] = useState("default");

  async function load() {
    const data = await api<{ notifications: Item[] }>("/api/notifications");
    setItems(data.notifications);
  }

  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
    load().catch((err) => setError(err instanceof ApiError ? err.message : "โหลดไม่สำเร็จ"));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold">การแจ้งเตือน</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
        ลีดที่เป็นคนกำลังหา หรือชนคำเฝ้าดู จะโผล่ที่นี่ ฟีดจะส่งเสียงและแจ้งเตือนเบราว์เซอร์ถ้าอนุญาต ส่วน LINE, Discord และอีเมลตั้งในหน้าตั้งค่า
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            if (typeof Notification === "undefined") return;
            const result = await Notification.requestPermission();
            setPermission(result);
          }}
        >
          อนุญาตแจ้งเตือนเบราว์เซอร์ ({permission})
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await api("/api/notifications", { method: "POST", body: JSON.stringify({ all: true }) });
            await load();
          }}
        >
          อ่านทั้งหมดแล้ว
        </Button>
        <Button
          onClick={async () => {
            setInfo("");
            try {
              const result = await api<{ channels?: Record<string, { ok: boolean; skipped?: boolean; message: string }> }>(
                "/api/notifications/test",
                { method: "POST" },
              );
              const lines = Object.entries(result.channels ?? {}).map(
                ([name, item]) => `${name}: ${item.skipped ? "ยังไม่ตั้ง" : item.message}`,
              );
              setInfo(["ส่งในแอปแล้ว", ...lines].join(" · "));
              await load();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "ทดสอบไม่สำเร็จ");
            }
          }}
        >
          ทดสอบการแจ้งเตือน
        </Button>
      </div>
      {info ? <p className="mt-3 text-sm text-pine">{info}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-4 space-y-3">
        {items.length ? items.map((item) => (
          <Card key={item.id} className={item.read ? "" : "border-clay/40"}>
            <div className="flex items-center gap-2">
              <Badge>{CHANNEL[item.channel] ?? item.channel}</Badge>
              <strong className="text-sm">{item.title}</strong>
              <span className="ml-auto text-xs text-muted">{timeAgo(item.createdAt)}</span>
            </div>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6">{item.body}</pre>
          </Card>
        )) : (
          <p className="mt-8 text-sm text-muted">ยังไม่มีการแจ้งเตือน เมื่อมีลีดที่ตรงเงื่อนไขจะมาอยู่ตรงนี้</p>
        )}
      </div>
    </div>
  );
}
