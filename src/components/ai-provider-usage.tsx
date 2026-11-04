"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Badge, Card } from "@/components/ui";

export type ProviderView = {
  id: string;
  name: string;
  preset: string;
  kind: string;
  baseUrl: string;
  model: string;
  apiKeyHint: string | null;
  hasKey: boolean;
  enabled: boolean;
  priority: number;
  tasks: string[];
  limitPerMinute: number | null;
  limitPerDay: number | null;
  resetHourUtc: number;
  origin: string;
  usageDay: string | null;
  requestsToday: number;
  tokensToday: number;
  requestsTotal: number;
  tokensTotal: number;
  errorsTotal: number;
  lastLatencyMs: number | null;
  lastUsedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  cooldownUntil: string | null;
  cooldownReason: string | null;
  coolingDown: boolean;
};

const REASONS: Record<string, string> = {
  rate: "ถูกจำกัดความถี่",
  quota: "โควตา/เครดิตหมด",
  auth: "คีย์ใช้ไม่ได้",
  server: "เซิร์ฟเวอร์ขัดข้อง",
  timeout: "หมดเวลา",
};

export function bangkokTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

export function ProviderStatus({ provider }: { provider: ProviderView }) {
  if (!provider.enabled) return <Badge>ปิดอยู่</Badge>;
  if (provider.coolingDown)
    return (
      <Badge tone="amber">
        พัก ({REASONS[provider.cooldownReason ?? ""] ?? "ผิดพลาด"}) ถึง {bangkokTime(provider.cooldownUntil)}
      </Badge>
    );
  return <Badge tone="pine">พร้อมใช้</Badge>;
}

/** Compact usage table for /overview. */
export function AiProviderUsage() {
  const [providers, setProviders] = useState<ProviderView[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const load = () =>
      api<{ providers: ProviderView[] }>("/api/ai-providers")
        .then((data) => setProviders(data.providers))
        .catch(() => setError("โหลดรายการ AI ไม่สำเร็จ"));
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <Card className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">ผู้ให้บริการ AI (สลับอัตโนมัติ)</h2>
        <Link href="/settings/ai-providers" className="text-sm text-clay underline">จัดการ</Link>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {providers && !providers.length ? <p className="mt-2 text-sm text-muted">ยังไม่มีผู้ให้บริการ ระบบใช้ค่าจาก .env และคีย์เวิร์ด</p> : null}
      {providers?.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1">ลำดับ</th>
                <th>ชื่อ</th>
                <th>สถานะ</th>
                <th>วันนี้</th>
                <th>โทเคนวันนี้</th>
                <th>ผิดพลาด</th>
                <th>ล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider, index) => (
                <tr key={provider.id} className="border-t border-line">
                  <td className="py-1.5">{index + 1}</td>
                  <td>
                    {provider.name} <span className="text-xs text-muted">{provider.model}</span>
                  </td>
                  <td><ProviderStatus provider={provider} /></td>
                  <td>
                    {provider.requestsToday}
                    {provider.limitPerDay ? ` / ${provider.limitPerDay}` : ""}
                  </td>
                  <td>{provider.tokensToday.toLocaleString()}</td>
                  <td title={provider.lastError ?? ""}>{provider.errorsTotal}</td>
                  <td>{provider.lastLatencyMs ? `${provider.lastLatencyMs} ms` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">ถ้าทุกตัวพักอยู่ ระบบจะจัดหมวดด้วยคีย์เวิร์ดแทน แล้วกลับมาใช้ AI เองเมื่อหมดเวลาพัก</p>
        </div>
      ) : null}
    </Card>
  );
}