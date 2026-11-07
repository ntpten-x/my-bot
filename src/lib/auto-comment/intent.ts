import { normalizeText } from "../pipeline/normalize";
import { detectIntent } from "../pipeline/intent";

/** Conservative Thai intent gate, shared by preview and every browser send gate. */
export function commentIntent(post: { text: string; intent?: string; aiProvider?: string | null }) {
  const text = normalizeText(post.text).replace(/\u0e4d\u0e32/g, "ำ");
  // Attribute exclusions are not withdrawal of the main buying intent.
  const buyerRequest = /หาซื้อ|ตามหา|อยากได้|มองหา|ต้องการซื้อ|ขอคำแนะนำ|ช่วยแนะนำ|(?:^|\s)หา(?!รายได้|ยใจ|ยไป|ยแล้ว)/.test(text);
  const scope = text.replace(/ไม่ซื้อ(?:ของปลอม|ของก๊อป|ของกอป|ของเทียม)/g, " ")
    .replace(/ไม่ต้องการ(?:สี|ไซซ์|ไซส์|ขนาด|รุ่น|ของปลอม)[^\s]*/g, " ")
    .replace(buyerRequest ? /ไม่ขาย[^\s]*/g : /$^/g, " ");
  const closed = /ไม่(?:ได้)?\s*(?:หา|ซื้อ|ขาย|ต้องการ)|เลิกหา|หยุดหา|ขาย\s*(?:แล้ว|หมด)|ปิด\s*(?:การขาย|รับ|โพสต์)|(?<!อยาก)ได้(?:ของ|สินค้า|รองเท้า)?\s*แล้ว|หาได้แล้ว|ไม่เอาแล้ว/.exec(scope);
  if (closed) return { value: "closed", closed: true, evidence: closed[0], by: "rules" };
  const buyer = /หาซื้อ|ตามหา|อยากได้|มองหา|ต้องการซื้อ|ขอคำแนะนำ|ช่วยแนะนำ|แนะนำ.{0,30}(?:หน่อย|ที|ได้ไหม)|(?:^|[\s.!?])หา(?!รายได้|ยใจ|ยไป|ยแล้ว)[ก-๙a-z0-9]/.exec(text);
  const seller = /ขาย|ปล่อย|รับทำ|รับจ้าง|พร้อมส่ง/.exec(text);
  // Completed AI/owner labels may refine the intent, but never override a closed signal.
  const authoritative = Boolean(post.aiProvider && !post.aiProvider.startsWith("rules"));
  if (authoritative && post.intent && post.intent !== "unknown") {
    return { value: post.intent, closed: false, evidence: buyer?.[0] ?? seller?.[0] ?? "", by: "classification" };
  }
  const value = buyer ? "buyer" : detectIntent(text);
  return { value, closed: false, evidence: buyer?.[0] ?? seller?.[0] ?? "", by: "rules" };
}
