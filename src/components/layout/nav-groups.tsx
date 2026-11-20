"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, type NavGroupId } from "./nav-config";
import {
  groupIdForPath,
  isNavItemActive,
  readGroupOpenState,
  resolveGroupOpen,
  writeGroupOpenState,
} from "./nav-groups-state";

export function NavGroups({
  pathname,
  unread,
  onNavigate,
}: {
  pathname: string;
  unread: number;
  onNavigate?: () => void;
}) {
  const [stored, setStored] = useState(() => readGroupOpenState(null));

  useEffect(() => {
    setStored(readGroupOpenState());
  }, []);

  function toggle(id: NavGroupId) {
    if (groupIdForPath(pathname) === id) return;
    setStored((current) => {
      const next = { ...current, [id]: !current[id] };
      writeGroupOpenState(next);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-1">
      {NAV_GROUPS.map((group) => {
        const open = resolveGroupOpen(group.id, pathname, stored);
        const lockedOpen = groupIdForPath(pathname) === group.id;
        return (
          <div key={group.id}>
            <button
              type="button"
              aria-expanded={open}
              disabled={lockedOpen}
              aria-disabled={lockedOpen}
              onClick={() => toggle(group.id)}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs text-white/55 hover:bg-white/5 disabled:opacity-100"
            >
              <span>{group.label}</span>
              <ChevronDown size={14} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
            </button>
            {open ? (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isNavItemActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => onNavigate?.()}
                      className={cn(
                        "relative flex items-center gap-2 rounded-lg py-2 pl-3 pr-3 text-sm",
                        active ? "bg-accent-soft text-white" : "text-white/75 hover:bg-white/5",
                        active && "before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-accent",
                      )}
                    >
                      <Icon size={16} />
                      <span className="min-w-0 flex-1">{item.label}</span>
                      {item.href === "/notifications" && unread > 0 ? (
                        <span className="rounded-full bg-accent px-2 text-xs font-semibold text-sidebar">{unread}</span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
