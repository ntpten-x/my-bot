/** Default page size for the auto-comment job history list. */
export const COMMENT_JOBS_PAGE_SIZE = 10;

/** Status buckets for the owner-facing job history filter. */
export const WAITING_JOB_FILTER = ["pending_ai", "browser_ready", "pending", "claimed", "sending"] as const;
export const REVIEW_JOB_FILTER = ["uncertain", "failed", "permission_denied", "unavailable", "not_sent"] as const;

/** Owner-facing job list always hides simulation rows and can narrow by status bucket. */
export function commentJobsWhere(filter = "all"): { dryRun: false; status?: string | { in: string[] } } {
  const base = { dryRun: false as const };
  if (filter === "waiting") return { ...base, status: { in: [...WAITING_JOB_FILTER] } };
  if (filter === "review") return { ...base, status: { in: [...REVIEW_JOB_FILTER] } };
  if (filter && filter !== "all") return { ...base, status: filter };
  return base;
}

/** Owner-facing labels for AutoCommentJob / audit events. */
export const COMMENT_JOB_STATUSES: Record<string, string> = {
  not_sent: "ไม่ได้เรียกปุ่มส่ง",
  rule_deleted: "ลบชุดตั้งค่า",
  rule_enabled: "เปิดชุดตั้งค่า",
  rule_disabled: "ปิดชุดตั้งค่า",
  pending_ai: "รอเตรียมข้อความ / ตรวจเงื่อนไขกฎ",
  browser_ready: "รอ Extension",
  browser_observed: "พบคอมเมนต์ในหน้าจอ",
  pending: "รอส่ง",
  claimed: "ตรวจสิทธิ์",
  sending: "กำลังส่ง",
  sent: "ส่งสำเร็จ",
  dry_run: "จำลองแล้ว",
  unsupported: "Unsupported — ส่งเอง",
  permission_denied: "สิทธิ์ไม่ผ่าน",
  unavailable: "เข้าถึงโพสต์ไม่ได้",
  uncertain: "ไม่ทราบผล — ตรวจเอง ห้ามส่งซ้ำ",
  failed: "ล้มเหลว",
  cancelled: "ยกเลิกแล้ว",
};

const DEFERRED_STATUSES = new Set(["browser_ready", "pending_ai", "pending", "claimed"]);

/** Prefer durable lastError (quota/cooldown/worker) over the coarse browser_ready label. */
export function commentJobHeadline(status: string, lastError = ""): string {
  const err = String(lastError || "").trim();
  if (err && DEFERRED_STATUSES.has(status)) return err;
  return COMMENT_JOB_STATUSES[status] ?? status;
}

/** Extension delivery counts observed comments; Graph legacy uses sent. */
export function commentSuccessCount(counts: Record<string, number> = {}): number {
  return (counts.browser_observed ?? 0) + (counts.sent ?? 0);
}
