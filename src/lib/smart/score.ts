export const HOT_SCORE = 80;

export type ScoreSignals = {
  urgency: number;
  hasBudget: boolean;
  specificity: number;
};

export type ScoreInput = {
  text: string;
  intent: string;
  isAd: boolean;
  forbidden: boolean;
  keywordHits: number;
  ageHours: number;
  sourceQuality: number;
  signals?: ScoreSignals | null;
  preference?: number;
};

function clamp(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function ruleSignals(text: string): ScoreSignals {
  const urgency = /ด่วน|วันนี้|ตอนนี้|รีบ|ภายในวันนี้/.test(text) ? 0.95 : /อยากได้|หาคน|รับซื้อ|ตามหา|พอรู้จัก|มั้ย|มั๊ย/.test(text) ? 0.75 : 0.25;
  const hasBudget = /งบ|บาท|฿|\d{3,}/.test(text);
  const product = /ipad|iphone|ไอแพด|ไอโฟน|มือถือ|แท็บเล็ต|tablet|การ์ดจอ|โน้ตบุ๊ก|โน๊ตบุ๊ค|มือสอง/i.test(text) ? 0.4 : 0;
  const specificity = Math.min(1, (text.trim().length > 40 ? 0.35 : 0.1) + (/\d/.test(text) ? 0.2 : 0) + product);
  return { urgency, hasBudget, specificity };
}

export function scoreLead(input: ScoreInput): { score: number; reason: string } {
  if (input.forbidden) return { score: 5, reason: "มีคำต้องห้าม" };
  if (input.isAd || input.intent === "ad") return { score: 8, reason: "ดูเหมือนโฆษณาหรือประกาศขายส่ง" };
  const signals = input.signals ?? ruleSignals(input.text);
  let score = 0;
  const bits: string[] = [];
  if (input.intent === "buyer") {
    score += 46;
    bits.push("คนกำลังหา");
  } else if (input.intent === "seller") {
    score += 8;
    bits.push("คนกำลังขาย");
  } else score += 4;

  const urgency = clamp(signals.urgency);
  score += Math.round(urgency * 18);
  if (urgency >= 0.6) bits.push("เร่งด่วน");
  if (signals.hasBudget) {
    score += 12;
    bits.push("ระบุงบ");
  }
  const specificity = clamp(signals.specificity);
  score += Math.round(specificity * 12);
  if (specificity >= 0.6) bits.push("รายละเอียดชัด");

  const keywordPoints = Math.min(15, Math.max(0, input.keywordHits) * 6);
  score += keywordPoints;
  if (input.keywordHits > 0) bits.push("ตรงคำเฝ้าดู");

  const recency = input.ageHours <= 6 ? 18 : input.ageHours <= 24 ? 12 : input.ageHours <= 72 ? 6 : 1;
  score += recency;
  if (recency >= 10) bits.push("โพสต์ใหม่");

  score += Math.round(clamp(input.sourceQuality) * 10);
  const preference = Math.round(clamp(input.preference ?? 0, -1, 1) * 15);
  score += preference;
  if (preference >= 5) bits.push("ตรงกับที่คุณสนใจ");
  if (preference <= -5) bits.push("คล้ายโพสต์ที่คุณข้าม");

  return {
    score: Math.max(0, Math.min(100, score)),
    reason: bits.join(" · ") || "สัญญาณยังไม่ชัด",
  };
}
