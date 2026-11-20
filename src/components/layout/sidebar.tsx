"use client";

import { LogOut } from "lucide-react";
import { NavGroups } from "./nav-groups";
import { ThemeToggle } from "./theme-toggle";

export function Sidebar({
  pathname,
  unread,
  onLogout,
}: {
  pathname: string;
  unread: number;
  onLogout: () => void;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen flex-col bg-sidebar text-white md:flex">
      <div className="px-5 py-6">
        <div className="text-2xl font-semibold">MY-BOT</div>
        <p className="mt-2 text-xs leading-5 text-white/70">เรดาร์ลีดส่วนตัว ไม่มีบิล ไม่มีผู้ใช้คนที่สอง</p>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3" aria-label="เมนูหลัก">
        <NavGroups pathname={pathname} unread={unread} />
      </nav>
      <div className="border-t border-white/10">
        <div className="mx-3 mb-2 mt-3 flex items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2">
          <span className="text-xs text-white/70">ธีม</span>
          <ThemeToggle className="border-white/15 bg-white/5 text-white hover:bg-white/10" />
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="m-3 mt-0 flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/70 hover:bg-white/5"
        >
          <LogOut size={16} /> ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}
