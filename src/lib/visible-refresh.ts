/** Repair changes to existing posts that an insert-only SSE cursor cannot deliver. */
export function startVisibleRefresh(refresh: () => Promise<unknown>, doc: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> = document, intervalMs = 5000) {
  let stopped = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout>;
  const run = async () => {
    if (stopped || busy) return;
    busy = true;
    try { if (!doc.hidden) await refresh(); } catch { /* The next visible refresh repairs errors. */ }
    finally {
      busy = false;
      if (!stopped) timer = setTimeout(() => { void run(); }, intervalMs);
    }
  };
  const visible = () => {
    if (!doc.hidden && !busy && !stopped) { clearTimeout(timer); void run(); }
  };
  timer = setTimeout(() => { void run(); }, intervalMs);
  doc.addEventListener("visibilitychange", visible);
  return () => { stopped = true; clearTimeout(timer); doc.removeEventListener("visibilitychange", visible); };
}
