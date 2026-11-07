// Per-source coverage: is the extension likely to be missing new posts? Pure, so it is unit-tested.

export type CoverageRun = {
  createdAt: Date;
  mode: string;
  ok: boolean;
  found: number;
  fresh: number;
  inserted: number;
  stoppedBy: string;
  reachedKnown: boolean;
  hitLimit: boolean;
  stalls: number;
};

export type CoverageLevel = "ok" | "warn" | "bad" | "unknown";

export type Coverage = {
  level: CoverageLevel;
  label: string;
  reasons: string[];
  runs: number;
  reachedKnownPct: number | null;
  missedInAudit: number | null;
};

const LABEL: Record<CoverageLevel, string> = {
  ok: "ไม่พบสัญญาณตกหล่น",
  warn: "อาจตกหล่น",
  bad: "น่าจะตกหล่น",
  unknown: "ยังไม่มีข้อมูล",
};

export function assessCoverage(input: {
  runs: CoverageRun[];
  lastRunAt: Date | null;
  intervalMinutes: number;
  autoFetchOn: boolean | null;
  hasStoredPosts: boolean;
  now?: Date;
}): Coverage {
  const now = (input.now ?? new Date()).getTime();
  const reasons: string[] = [];
  let level: CoverageLevel = "ok";
  const raise = (next: CoverageLevel, reason: string) => {
    reasons.push(reason);
    if (next === "bad" || (next === "warn" && level === "ok")) level = next;
  };
  const day = input.runs.filter((run) => now - run.createdAt.getTime() <= 24 * 3600_000);
  const normal = day.filter((run) => run.ok && run.mode !== "audit");

  if (input.autoFetchOn === false) raise("bad", "ยังไม่ได้ติ๊ก “เปิดใช้งาน” ในป๊อปอัปส่วนขยาย — ไม่มีการอ่านเลย");
  const gapMin = input.lastRunAt ? (now - input.lastRunAt.getTime()) / 60000 : Infinity;
  if (gapMin > Math.max(60, input.intervalMinutes * 4)) {
    raise("bad", input.lastRunAt ? `ไม่ได้อ่านมา ${Math.round(gapMin / 60)} ชม. (Chrome หรือส่วนขยายปิดอยู่?)` : "ยังไม่เคยอ่าน");
  }
  const errors = day.filter((run) => !run.ok).length;
  if (errors >= 2 && errors >= day.length / 2) raise("warn", `อ่านผิดพลาด ${errors} จาก ${day.length} รอบใน 24 ชม.`);
  const limited = normal.filter((run) => run.hitLimit && !run.reachedKnown).length;
  if (limited) raise("warn", `${limited} รอบเลื่อนจนสุดขีดจำกัดแต่ยังไม่ถึงโพสต์ที่เก็บแล้ว`);
  const thin = normal.filter((run) => run.found <= 1 && run.stoppedBy === "end").length;
  if (thin >= 2 && thin >= normal.length / 2) raise("warn", `${thin} รอบเห็นแค่ ≤1 โพสต์ — หน้าเพจในแท็บพื้นหลังอาจโหลดไม่ขึ้น`);
  const stalled = normal.filter((run) => run.stalls >= 3).length;
  if (stalled >= 2) raise("warn", `${stalled} รอบหน้าเพจโหลดค้าง`);
  const audit = input.runs.find((run) => run.mode === "audit" && run.ok);
  const missed = audit ? audit.inserted : null;
  if (missed !== null && missed > 0) raise(missed >= 3 ? "bad" : "warn", `ตรวจความครบล่าสุดเจอโพสต์ที่ตกหล่น ${missed} โพสต์`);

  const withKnown = normal.filter((run) => run.reachedKnown).length;
  const pct = normal.length ? Math.round((withKnown / normal.length) * 100) : null;
  if (input.hasStoredPosts && normal.length >= 3 && pct !== null && pct < 50 && !limited) {
    raise("warn", `มีแค่ ${pct}% ของรอบที่เลื่อนจนเจอโพสต์ที่เก็บแล้ว`);
  }
  if (!input.runs.length && level === "ok") level = "unknown";
  return { level, label: LABEL[level], reasons, runs: day.length, reachedKnownPct: pct, missedInAudit: missed };
}