import { scoreAd } from "./ad-filter";

const LOOKING_FOR_PERSON = /หาคนรับ|หาคน|ตามหาคน|อยากได้คน|ต้องการคนรับ|พอรู้จัก/;
const BUYER =
  /หารหัส|หาไอดี|หาid|รับซื้อ|หาซื้อ|ตามหา|อยากได้|มองหา|ต้องการ|หาคน|ใครมี|มีใครขาย|ใครขาย|จัดหา|รบกวนแนะนำ|รบกวนหา|ต้องการซื้อ|ต้องการหา|พอรู้จัก|มั้ย|มั๊ย|มั้ยคะ|มีมั้ย|(?:^|\s)หา(?:\s|คน|ซื้อ|รถ|บ้าน|ห้อง|ของ|ไอ|i)/i;
const SELLER = /ขาย|ปล่อย|รับทำ|รับจ้าง|รับเติม|รับออกแบบ|บริการ|พร้อมส่ง|มีของ|เปิดรับ|รับผลิต/;
const BUYER_WINS = /หารหัส|หาไอดี|หาคน|ตามหา|อยากได้|รับซื้อ|หาซื้อ|ใครมี|รบกวนแนะนำ|รบกวนหา|ต้องการ|มองหา|พอรู้จัก|มั้ย|มั๊ย|(?:^|\s)หา\s/;
export const STRONG_SELLER = /พร้อมส่ง|รับทำ|รับออกแบบ|รับจ้าง|ขาย|ปล่อย/;
export const STRONG_BUYER = BUYER_WINS;

export type Intent = "buyer" | "seller" | "ad" | "unknown";

export function detectIntent(text: string): Intent {
  if (scoreAd(text).isAd) return "ad";
  if (LOOKING_FOR_PERSON.test(text)) return "buyer";
  const buyer = BUYER.test(text);
  const seller = SELLER.test(text);
  if (buyer && !seller) return "buyer";
  if (seller && !buyer) return "seller";
  if (buyer && seller) return BUYER_WINS.test(text) ? "buyer" : "seller";
  if (/ด่วน/.test(text) && !seller) return "buyer";
  return "unknown";
}
