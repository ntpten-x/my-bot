import type { Intent } from "./intent";

/** Rules fallback: owner sells to buyers, asks sellers for details, stays neutral otherwise. */
export function draftReply(intent: Intent, categoryName: string): string {
  if (intent === "buyer") {
    return `สวัสดีครับ มีของตรงตามที่กำลังหาในหมวด${categoryName} พร้อมคุยรายละเอียดราคาและเงื่อนไขได้เลยครับ`;
  }
  if (intent === "seller") {
    return `สวัสดีครับ สนใจประกาศในหมวด${categoryName} รบกวนขอรายละเอียดราคาและสภาพเพิ่มเติมหน่อยครับ`;
  }
  if (intent === "ad") return "";
  return `สวัสดีครับ ขออนุญาตสอบถามรายละเอียดเพิ่มเติมจากประกาศนี้หน่อยครับ`;
}

/** Drop AI drafts that are empty, non-Thai, garbled, or reverse the owner's role. */
export function isUsableSuggestedReply(reply: string, intent: Intent): boolean {
  const text = reply.trim();
  if (text.length < 12 || text.length > 500) return false;
  if (/https?:\/\//i.test(text)) return false;
  const thaiChars = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
  if (thaiChars < 8) return false;
  // Model sometimes emits latin stubs instead of Thai words (e.g. "rahs" for รหัส).
  if (/\brahs?\b/i.test(text)) return false;
  if (intent === "buyer") {
    // Poster is looking to buy — owner should offer/sell, not "รับซื้อกลับ".
    if (/ยินดีรับซื้อ|ทางเรายินดีรับซื้อ|รับซื้อรหัส\s*ของ\s*คุณ|รับซื้อของ\s*คุณ/.test(text)) return false;
  }
  return true;
}
