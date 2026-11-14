"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, Bell, BookOpen, Bookmark, Bug, LayoutDashboard, Lightbulb, LogOut, MessageSquareText, Radar, Rss, Settings, Sun, Tags, Users, Workflow } from "lucide-react";
import { StepUpPrompt } from "./security-controls";
import { api } from "./api";
import { cn } from "@/lib/utils";
import { startVisibleRefresh } from "@/lib/visible-refresh";

const NAV = [
  { href: "/getting-started", label: "เริ่มใช้งาน", icon: Activity },
  { href: "/overview", label: "ภาพรวมระบบ", icon: Activity },
  { href: "/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard },
  { href: "/feed", label: "ฟีดลีด", icon: Radar },
  { href: "/pipeline", label: "ไปป์ไลน์", icon: Bookmark },
  { href: "/messages", label: "จัดการข้อความ", icon: MessageSquareText },
  { href: "/templates", label: "ข้อความสำเร็จรูป", icon: MessageSquareText },
  { href: "/automation", label: "กฎและพื้นที่", icon: Workflow },
  { href: "/auto-comment", label: "คอมเมนต์อัตโนมัติ", icon: MessageSquareText },
  { href: "/accounts", label: "จัดการบัญชี", icon: Users },
  { href: "/groups", label: "จัดการกลุ่ม", icon: Users },
  { href: "/sources", label: "แหล่งข้อมูล", icon: Rss },
  { href: "/parser", label: "ทดสอบตัวอ่าน", icon: Bug },
  { href: "/categories", label: "หมวดและคีย์เวิร์ด", icon: Tags },
  { href: "/learn", label: "เรียนรู้", icon: Lightbulb },
  { href: "/summaries", label: "สรุปรายวัน", icon: Sun },
  { href: "/notifications", label: "การแจ้งเตือน", icon: Bell },
  { href: "/guide", label: "วิธีใช้", icon: BookOpen },
  { href: "/settings", label: "ตั้งค่า", icon: Settings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let stop = false;
    let loading = false;
    const controller = new AbortController();
    const load = async () => {
      if (stop || loading) return;
      loading = true;
      await api<{ unread: number }>("/api/notifications?countOnly=1", { signal: controller.signal })
        .then((data) => {
          if (!stop) setUnread(data.unread);
        })
        .catch(() => undefined)
        .finally(() => { loading = false; });
    };
    if (!document.hidden) void load();
    const stopRefresh = startVisibleRefresh(load, document, 20000);
    return () => {
      stop = true;
      stopRefresh();
      controller.abort();
    };
  }, [pathname]);

  useEffect(() => {
    let sent = 0;
    const activity = () => {
      if (document.hidden || Date.now() - sent < 60_000) return;
      sent = Date.now();
      void api("/api/auth/activity", { method: "POST" }).catch(() => undefined);
    };
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("pointermove", activity, { passive: true });
    window.addEventListener("wheel", activity, { passive: true });
    window.addEventListener("keydown", activity);
    window.addEventListener("focus", activity);
    return () => { window.removeEventListener("pointermove", activity); window.removeEventListener("wheel", activity); window.removeEventListener("pointerdown", activity); window.removeEventListener("keydown", activity); window.removeEventListener("focus", activity); };
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <StepUpPrompt />
      <aside className="hidden bg-sidebar text-paper md:flex md:flex-col">
        <div className="px-5 py-6">
          <div className="text-xs tracking-[0.18em] text-amber">LEAD RADAR</div>
          <div className="mt-1 text-2xl font-semibold">MY-BOT</div>
          <p className="mt-2 text-xs leading-5 text-paper/70">เรดาร์ลีดส่วนตัว ไม่มีบิล ไม่มีผู้ใช้คนที่สอง</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2 text-sm",
                  active ? "bg-white/10 text-white" : "text-paper/75 hover:bg-white/5",
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon size={16} />
                  {item.label}
                </span>
                {item.href === "/notifications" && unread > 0 ? (
                  <span className="rounded-full bg-clay px-2 text-xs text-white">{unread}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <button onClick={logout} className="m-3 flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-paper/70 hover:bg-white/5">
          <LogOut size={16} /> ออกจากระบบ
        </button>
      </aside>
      <div>
        <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="font-semibold">MY-BOT</div>
            <button onClick={logout} className="text-sm text-muted">ออก</button>
          </div>
          <nav className="flex gap-2 overflow-x-auto px-3 pb-3">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-sm",
                  pathname === item.href ? "border-clay bg-clay text-white" : "border-line bg-card",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
