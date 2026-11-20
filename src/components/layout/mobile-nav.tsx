"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { LogOut, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavGroups } from "./nav-groups";

export function MobileNav({
  open,
  pathname,
  unread,
  onClose,
  onLogout,
  menuButtonRef,
}: {
  open: boolean;
  pathname: string;
  unread: number;
  onClose: () => void;
  onLogout: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) {
      setShown(false);
      if (wasOpen.current) {
        wasOpen.current = false;
        menuButtonRef.current?.focus();
      }
      return;
    }

    wasOpen.current = true;
    const frame = requestAnimationFrame(() => setShown(true));
    closeRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, menuButtonRef]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 md:hidden">
      <button
        type="button"
        aria-label="ปิดเมนู"
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none",
          shown ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <div
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="เมนู"
        className={cn(
          "absolute inset-y-0 left-0 flex w-[min(100%,260px)] flex-col bg-sidebar text-white transition-transform duration-200 motion-reduce:transition-none",
          shown ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div className="text-lg font-semibold">MY-BOT</div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="ปิดเมนู"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-3" aria-label="เมนูหลัก">
          <NavGroups pathname={pathname} unread={unread} onNavigate={onClose} />
        </nav>
        <div className="border-t border-white/10">
          <button
            type="button"
            onClick={onLogout}
            className="m-3 flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/70 hover:bg-white/5"
          >
            <LogOut size={16} /> ออกจากระบบ
          </button>
        </div>
      </div>
    </div>
  );
}
