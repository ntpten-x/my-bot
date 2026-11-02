const STRONG = [
  /โฆษณา/,
  /sponsored/i,
  /สั่งซื้อเลย/,
  /โค้ดส่วนลด/,
  /flash sale/i,
  /ส่งฟรีทั่วไทย/,
  /ร้านค้าออนไลน์/,
  /เซลล์เพจ/,
];

const WEAK = [/โปรโมชั่น/, /ลดราคา/, /แอดไลน์/, /ทักไลน์/i, /ทักแชท/, /ทักอินบ็อก/, /inbox/i];

export function scoreAd(text: string): { isAd: boolean; score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  for (const pattern of STRONG) {
    if (pattern.test(text)) {
      score += 2;
      reasons.push(pattern.source);
    }
  }
  for (const pattern of WEAK) {
    if (pattern.test(text)) {
      score += 1;
      reasons.push(pattern.source);
    }
  }
  const prices = text.match(/฿\s?\d|\d[\d,]*\s?บาท/g);
  if (prices && prices.length >= 3) {
    score += 2;
    reasons.push("many-prices");
  }
  return { isAd: score >= 2, score, reasons };
}
