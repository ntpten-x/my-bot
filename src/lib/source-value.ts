export type SourceValueInput = {
  enabled: boolean; intervalMinutes: number; totalPosts: number; buyerPosts: number; contactedPosts: number; wonPosts: number;
  dismissedPosts: number; truncatedPosts: number; processingPending: number; runCount: number; errorRuns: number;
  hasCurrentVersionHeartbeat: boolean; lastExtensionAt: Date | null;
};
export type SourceValueAdvice = { action: 'increase' | 'decrease' | 'keep' | 'repair' | 'unknown'; reason: string; suggestedIntervalMinutes: number | null };

// Advisory only. Owner outcomes are current states of stored posts, not causal sales attribution.
export function sourceValueAdvice(row: SourceValueInput, now = new Date()): SourceValueAdvice {
  const result = (action: SourceValueAdvice['action'], reason: string, suggestedIntervalMinutes: number | null = null) => ({ action, reason, suggestedIntervalMinutes });
  if (!row.enabled) return result('keep', 'แหล่งนี้ปิดอยู่ รักษาการตั้งค่าของเจ้าของ');
  const age = row.lastExtensionAt ? now.getTime() - row.lastExtensionAt.getTime() : NaN;
  if (!row.hasCurrentVersionHeartbeat || !Number.isFinite(age) || age < 0 || age > Math.max(30, row.intervalMinutes * 3) * 60000) return result('unknown', 'ยังไม่มีหลักฐานการอ่านล่าสุดของรุ่นปัจจุบันเพียงพอ');
  if (row.runCount >= 3 && row.errorRuns / row.runCount >= .2) return result('repair', 'ตรวจข้อผิดพลาดการอ่านก่อนปรับความถี่');
  if (row.totalPosts >= 20 && row.truncatedPosts / row.totalPosts > .2) return result('repair', 'ข้อความยังไม่ครบเกิน 20% ของตัวอย่าง ควรตรวจการอ่านข้อความเต็ม');
  if (row.processingPending > Math.max(5, row.totalPosts / 4)) return result('repair', 'มีงานประมวลผลค้างมาก ควรตรวจคิวก่อนเพิ่มงานอ่าน');
  if (row.totalPosts < 20 || row.runCount < 3) return result('unknown', 'ต้องมีอย่างน้อย 20 โพสต์ไม่ซ้ำและ 3 รอบอ่าน จึงเสนอปรับความถี่');
  if (row.contactedPosts + row.wonPosts >= 3) {
    const next = Math.max(3, Math.floor(row.intervalMinutes / 2));
    return next < row.intervalMinutes ? result('increase', 'มีอย่างน้อย 3 รายการที่เจ้าของตอบ ติดต่อ หรือปิดการขาย ลองเพิ่มความถี่แล้ววัดผลใหม่', next) : result('keep', 'อ่านถี่อยู่แล้ว รักษาช่วงปัจจุบันและตรวจคุณภาพต่อ');
  }
  if (row.totalPosts >= 50 && row.dismissedPosts >= 20 && row.contactedPosts + row.wonPosts === 0) {
    const next = Math.min(180, row.intervalMinutes * 2);
    return next > row.intervalMinutes ? result('decrease', 'มีโพสต์อย่างน้อย 50 รายการ เจ้าของข้ามอย่างน้อย 20 และยังไม่มีผลติดต่อ ลองลดความถี่หลังตรวจตัวอย่าง', next) : result('keep', 'ช่วงอ่านอยู่ที่ขอบเขตสูงสุดแล้ว ควรตรวจกลุ่มและกฎคัดลีด');
  }
  return result('unknown', 'ผลจากเจ้าของยังไม่เพียงพอ ห้ามใช้คะแนนหรือจำนวนโพสต์แทนคุณค่าการขาย');
}
