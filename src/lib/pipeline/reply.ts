import type { Intent } from "./intent";

export function draftReply(intent: Intent, categoryName: string): string {
  if (intent === "buyer") {
    return `สวัสดีครับ มีของตรงตามที่กำลังหาในหมวด${categoryName} สะดวกทักรายละเอียดเพิ่มได้เลยนะครับ`;
  }
  if (intent === "seller") {
    return `สวัสดีครับ สนใจประกาศในหมวด${categoryName} รบกวนขอรายละเอียดราคาและสภาพเพิ่มเติมหน่อยครับ`;
  }
  return `สวัสดีครับ ขออนุญาตสอบถามรายละเอียดเพิ่มเติมจากประกาศนี้หน่อยครับ`;
}
