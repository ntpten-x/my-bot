const labels: Record<string, string> = {
  post_processing: "รอประมวลผลกฎของโพสต์ให้ครบ",
  full_text: "รออ่านข้อความฉบับเต็มก่อนคอมเมนต์",
  enabled: "กฎยังปิดอยู่", not_paused: "กฎถูกพัก", not_ad: "ถูกกรองเป็นโฆษณา",
  not_forbidden: "พบคำต้องห้าม", not_duplicate: "โพสต์ซ้ำ", not_dismissed: "เจ้าของข้ามโพสต์แล้ว",
  open_intent: "ปิดการหา/ขาย หรือมีข้อความปฏิเสธ", intent: "เจตนาไม่ตรงกฎ",
  source: "กลุ่มไม่อยู่ในกฎ", source_disabled: "แหล่งข้อมูลปิดอยู่", window: "ยังไม่ถึงเวลาทำงาน",
  type_scope: "กลุ่มไม่ได้อยู่ในประเภทที่กฎกำหนด หรือประเภทปิดใช้งาน",
  age: "อายุโพสต์ไม่อยู่ในช่วงที่กำหนด", excluded: "พบคำยกเว้น", keywords: "คำสำคัญไม่ครบตามกฎ",
  no_template: "ยังไม่มีข้อความตอบ", before_start: "โพสต์ก่อนเริ่มรอบนี้", unsupported_target: "ลิงก์โพสต์ไม่รองรับ",
  waiting_ai: "รอประเมินกฎใหม่", existing_delivery: "มีงานหรือประวัติส่งอยู่แล้ว",
  pending_ai: "งานรอตรวจความพร้อม", browser_ready: "งานรอ Extension", claimed: "อุปกรณ์รับงานแล้ว",
  not_sent: "สิ้นสุดก่อนเรียกปุ่มส่ง",
  sending: "เริ่มการส่งแล้ว", uncertain: "ต้องตรวจผล ห้ามส่งซ้ำ", browser_observed: "พบคอมเมนต์แล้ว",
  dry_run: "จำลองแล้ว", cancelled: "งานเดิมยกเลิกแล้ว",
};

/** Defensive parsing of stored audit metadata; unknown codes are never executable. */
export function evaluationReasons(value: string, rules: { id: string; name: string }[]) {
  try {
    const rows: unknown = JSON.parse(value);
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 31).flatMap(row => {
      if (!row || typeof row !== "object" || typeof row.ruleId !== "string" || !Array.isArray(row.codes)) return [];
      const name = rules.find(rule => rule.id === row.ruleId)?.name ?? "กฎที่บันทึกไว้";
      const messages = row.codes.filter((code: unknown): code is string => typeof code === "string").map((code: string) => labels[code] ?? "ตรวจประวัติงานเพิ่มเติม");
      return [`${name}: ${messages.length ? messages.join(" · ") : "ผ่านเงื่อนไขการจับคู่"}`];
    });
  } catch { return ["อ่านรายละเอียดไม่สำเร็จ"]; }
}
