export function fetchErrorReason(error: unknown, kind: string) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const reason = raw.replace(/\s+/g, " ").trim().slice(0, 400);
  return reason ? `${kind}: ${reason}` : `${kind}: ไม่ทราบสาเหตุ`;
}
