"use client";

import { Menu, X } from "lucide-react";
import type { RefObject } from "react";
import { ThemeToggle } from "./theme-toggle";

export function Header({
  open,
  onToggle,
  menuButtonRef,
}: {
  open: boolean;
  onToggle: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur md:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            ref={menuButtonRef}
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "ปิดเมนู" : "เปิดเมนู"}
            onClick={onToggle}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-card text-fg"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="font-semibold">MY-BOT</div>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
