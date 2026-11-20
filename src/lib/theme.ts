export type ThemeMode = "dark" | "light";

export const THEME_STORAGE_KEY = "theme";

export function resolveTheme(stored: string | null | undefined): ThemeMode {
  return stored === "light" ? "light" : "dark";
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  return current === "dark" ? "light" : "dark";
}

export function applyTheme(mode: ThemeMode, root: HTMLElement = document.documentElement): void {
  root.classList.remove("dark", "light");
  root.classList.add(mode);
}

export function readStoredTheme(storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): ThemeMode {
  try {
    return resolveTheme(storage?.getItem(THEME_STORAGE_KEY) ?? null);
  } catch {
    return "dark";
  }
}

export function writeStoredTheme(mode: ThemeMode, storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore quota / private mode
  }
}
