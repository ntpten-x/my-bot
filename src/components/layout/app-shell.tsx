"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { StepUpPrompt } from "../security-controls";
import { api } from "../api";
import { startVisibleRefresh } from "@/lib/visible-refresh";
import { useLiveUpdates } from "../live-updates";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { MobileNav } from "./mobile-nav";
import { Main } from "./main";
import { Footer } from "./footer";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { revision: liveRevision } = useLiveUpdates();

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
  }, [pathname, liveRevision]);

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
    return () => {
      window.removeEventListener("pointermove", activity);
      window.removeEventListener("wheel", activity);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("focus", activity);
    };
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  const closeNav = useCallback(() => setNavOpen(false), []);
  const toggleNav = useCallback(() => setNavOpen((value) => !value), []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[260px_1fr]">
      <StepUpPrompt />
      <Sidebar pathname={pathname} unread={unread} onLogout={() => void logout()} />
      <div className="min-w-0">
        <Header open={navOpen} onToggle={toggleNav} menuButtonRef={menuButtonRef} />
        <MobileNav
          open={navOpen}
          pathname={pathname}
          unread={unread}
          onClose={closeNav}
          onLogout={() => void logout()}
          menuButtonRef={menuButtonRef}
        />
        <Main>{children}</Main>
        <Footer />
      </div>
    </div>
  );
}

export { AppShell as Shell };
