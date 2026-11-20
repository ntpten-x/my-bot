"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api";
import { Card } from "./ui";
import { cn } from "@/lib/utils";
import type { SystemOverview } from "@/lib/system-overview";
import type { Level } from "@/lib/system-status";
import { startVisibleRefresh } from "@/lib/visible-refresh";

export type { SystemOverview };

export const LEVEL_STYLE: Record<Level, { dot: string; card: string; text: string; label: string }> = {
  ok: { dot: "bg-ok", card: "border-ok/30 bg-ok/10", text: "text-ok", label: "ปกติ" },
  warn: { dot: "bg-warn", card: "border-warn/30 bg-warn/10", text: "text-warn", label: "ควรดู" },
  bad: { dot: "bg-danger", card: "border-danger/30 bg-danger/10", text: "text-danger", label: "มีปัญหา" },
  off: { dot: "bg-muted", card: "border-line bg-card", text: "text-muted", label: "ไม่ได้ใช้" },
};

export function LevelDot({ level, className }: { level: Level; className?: string }) {
  return <span aria-label={LEVEL_STYLE[level].label} className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", LEVEL_STYLE[level].dot, className)} />;
}

// Polls /api/system/overview every 15 seconds while the page is visible.
export function useSystemOverview(intervalMs = 15000) {
  const [data, setData] = useState<SystemOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async (fresh = false) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const next = await api<SystemOverview>(`/api/system/overview${fresh ? "?fresh=1" : ""}`);
      setData(next);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "โหลดภาพรวมระบบไม่สำเร็จ");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!document.hidden) void load();
    return startVisibleRefresh(() => load(), document, intervalMs);
  }, [load, intervalMs]);

  return { data, error, loading, reload: load };
}

// Compact block for the dashboard: one line per section plus the cards that need attention.
export function SystemOverviewWidget() {
  const { data, error } = useSystemOverview();
  const problems = data ? data.sections.flatMap((item) => item.checks).filter((check) => check.level === "bad" || check.level === "warn") : [];
  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          {data ? <LevelDot level={data.overall} /> : null}
          ภาพรวมระบบ
        </h2>
        <Link href="/overview" className="text-sm text-accent hover:underline">
          ดูทั้งหมด →
        </Link>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      {!data && !error ? <p className="mt-2 text-sm text-muted">กำลังตรวจ...</p> : null}
      {data ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {data.sections.map((item) => (
              <div key={item.id} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm", LEVEL_STYLE[item.level].card)}>
                <LevelDot level={item.level} />
                <span className="font-medium">{item.title}</span>
                <span className={cn("ml-auto text-xs", LEVEL_STYLE[item.level].text)}>{LEVEL_STYLE[item.level].label}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm">
            Facebook:{" "}
            {data.facebook.loggedIn === true
              ? `ล็อกอินแล้ว ${data.facebook.loggedInCount} บัญชี`
              : data.facebook.loggedIn === false
                ? "ยังไม่ได้ล็อกอิน"
                : "ยังไม่ทราบ"}
            {data.facebook.accounts.length
              ? ` · ${data.facebook.accounts
                  .slice(0, 3)
                  .map((account) => `${account.name || "ไม่ทราบชื่อ"} (${account.id})`)
                  .join(", ")}`
              : ""}
          </p>
          {problems.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {problems.slice(0, 4).map((check) => (
                <li key={check.key} className="flex items-start gap-2">
                  <LevelDot level={check.level} className="mt-1.5" />
                  <span>
                    <span className="font-medium">{check.label}:</span> {check.value}
                    {check.hint ? <span className="text-muted"> — {check.hint}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ok">ทุกอย่างทำงานปกติ</p>
          )}
        </>
      ) : null}
    </Card>
  );
}
