"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { Lead } from "@/lib/lead";

type LiveUpdatesState = {
  revision: number;
  connected: boolean;
};

const LiveUpdatesContext = createContext<LiveUpdatesState>({ revision: 0, connected: false });

function beep() {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 740;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.04, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
  osc.start();
  osc.stop(ctx.currentTime + 0.28);
}

export function LiveUpdatesProvider({ children }: { children: React.ReactNode }) {
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const soundEnabled = useRef(true);

  useEffect(() => {
    void api<{ settings: { notifySound: boolean } }>("/api/settings")
      .then((data) => { soundEnabled.current = data.settings.notifySound; })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let stream: EventSource | null = null;
    const advance = () => setRevision((value) => value + 1);
    const connect = () => {
      if (stream || document.hidden) return;
      const next = new EventSource("/api/v1/stream");
      stream = next;
      next.onopen = () => setConnected(true);
      next.onerror = () => setConnected(false);
      next.onmessage = (event) => {
        let data: { type: string; posts?: Lead[] };
        try { data = JSON.parse(event.data); } catch { return; }
        if (!data || typeof data.type !== "string") return;
        if (data.type === "hello") { advance(); return; }
        if (data.type !== "posts" || !Array.isArray(data.posts) || !data.posts.length) return;
        const interesting = data.posts.filter((post) => !post.isAd && !post.forbiddenHit && !post.duplicateOfId);
        if (soundEnabled.current && interesting.length) beep();
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const post of interesting.slice(0, 2)) {
            new Notification("MY-BOT พบลีดใหม่", { body: post.text.slice(0, 140) });
          }
        }
        advance();
      };
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        stream?.close();
        stream = null;
        setConnected(false);
      } else {
        connect();
      }
    };
    connect();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stream?.close();
      stream = null;
    };
  }, []);

  const value = useMemo(() => ({ revision, connected }), [connected, revision]);
  return <LiveUpdatesContext.Provider value={value}>{children}</LiveUpdatesContext.Provider>;
}

export function useLiveUpdates() {
  return useContext(LiveUpdatesContext);
}
