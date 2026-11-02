export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "ยังไม่เคยดึง";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.round(hours / 24);
  return `${days} วันที่แล้ว`;
}

export const PIPELINE = [
  { id: "following", label: "กำลังติดตาม" },
  { id: "contacted", label: "ทักแล้ว" },
  { id: "closed_won", label: "ปิดการขายได้" },
  { id: "closed_lost", label: "ปิดไม่สำเร็จ" },
] as const;

export const INTENT_LABEL: Record<string, string> = {
  buyer: "กำลังหา",
  seller: "กำลังขาย",
  unknown: "ไม่ชัด",
};

export function bangkokStart(daysAgo = 0) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = formatter.format(new Date());
  const date = new Date(`${today}T00:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
}
