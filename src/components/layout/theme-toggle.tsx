"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ThemeMode,
  THEME_STORAGE_KEY,
  applyTheme,
  readStoredTheme,
  toggleTheme,
  writeStoredTheme,
} from "@/lib/theme";

function readAppliedTheme(): ThemeMode {
  const root = document.documentElement;
  if (root.classList.contains("light")) return "light";
  if (root.classList.contains("dark")) return "dark";
  return readStoredTheme();
}

export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("dark");

  useEffect(() => {
    const next = readStoredTheme();
    setMode(next);
    applyTheme(next);

    function onTheme(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === "dark" || detail === "light") setMode(detail);
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      const m = readStoredTheme();
      setMode(m);
      applyTheme(m);
    }

    window.addEventListener("mybot-theme", onTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("mybot-theme", onTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function onToggle() {
    const next = toggleTheme(readAppliedTheme());
    setMode(next);
    applyTheme(next);
    writeStoredTheme(next);
    window.dispatchEvent(new CustomEvent("mybot-theme", { detail: next }));
  }

  const label = mode === "dark" ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-card text-fg hover:bg-accent-soft",
        className,
      )}
    >
      {mode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
