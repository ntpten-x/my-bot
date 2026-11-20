import { NAV_GROUPS, type NavGroupId } from "./nav-config";

export const NAV_GROUPS_STORAGE_KEY = "mybot.nav.groups";

const DEFAULT_OPEN: Record<NavGroupId, boolean> = {
  start: true,
  leads: true,
  messages: false,
  automation: false,
  sources: false,
  system: false,
};

export function isNavItemActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/settings") return pathname.startsWith("/settings/");
  return false;
}

export function groupIdForPath(pathname: string): NavGroupId | null {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (isNavItemActive(pathname, item.href)) return group.id;
    }
  }
  return null;
}

export function readGroupOpenState(storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): Record<NavGroupId, boolean> {
  const base = { ...DEFAULT_OPEN };
  try {
    const raw = storage?.getItem(NAV_GROUPS_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<NavGroupId, boolean>>;
    for (const id of Object.keys(base) as NavGroupId[]) {
      if (typeof parsed[id] === "boolean") base[id] = parsed[id]!;
    }
  } catch {
    // ignore
  }
  return base;
}

export function writeGroupOpenState(state: Record<NavGroupId, boolean>, storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): void {
  try {
    storage?.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function resolveGroupOpen(groupId: NavGroupId, pathname: string, stored: Record<NavGroupId, boolean>): boolean {
  if (groupIdForPath(pathname) === groupId) return true;
  return stored[groupId];
}
