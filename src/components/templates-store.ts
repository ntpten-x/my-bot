"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/api";
import type { ReplyTemplateRow } from "@/lib/lead";

// One fetch shared by every lead card on the page.
let cache: Promise<ReplyTemplateRow[]> | null = null;
let cachedAt = 0;

export function invalidateTemplates() {
  cache = null;
}

export function useTemplates() {
  const [templates, setTemplates] = useState<ReplyTemplateRow[]>([]);
  useEffect(() => {
    let alive = true;
    if (!cache || Date.now() - cachedAt > 60_000) {
      cachedAt = Date.now();
      cache = api<{ templates: ReplyTemplateRow[] }>("/api/templates").then((data) => data.templates).catch(() => []);
    }
    void cache.then((rows) => { if (alive) setTemplates(rows); });
    return () => { alive = false; };
  }, []);
  return templates;
}
