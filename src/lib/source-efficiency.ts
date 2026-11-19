export type SourceRunEfficiencyInput = {
  runs: number;
  errorRuns: number;
  hitLimitRuns: number;
  found: number;
  fresh: number;
  inserted: number;
  stalls: number;
  durationMs: number;
};

export type SourceRunEfficiency = {
  level: "ok" | "warn" | "off";
  freshPerRun: number | null;
  stallRate: number | null;
  hitLimitRate: number | null;
  avgSeconds: number | null;
  reason: string;
};

export function sourceRunEfficiency(input: SourceRunEfficiencyInput): SourceRunEfficiency {
  const runs = Math.max(0, input.runs);
  const ratio = (value: number) => runs ? value / runs : null;
  const freshPerRun = ratio(Math.max(0, input.fresh));
  const stallRate = ratio(Math.max(0, input.stalls));
  const hitLimitRate = ratio(Math.max(0, input.hitLimitRuns));
  const avgSeconds = runs ? Math.round(Math.max(0, input.durationMs) / runs / 1000) : null;
  if (runs < 3) return {
    level: "off", freshPerRun, stallRate, hitLimitRate, avgSeconds,
    reason: "ต้องมีอย่างน้อย 3 รอบของรุ่นปัจจุบันก่อนประเมินประสิทธิภาพ",
  };
  if (input.errorRuns / runs >= 0.2) return {
    level: "warn", freshPerRun, stallRate, hitLimitRate, avgSeconds,
    reason: "มีรอบผิดพลาดตั้งแต่ 20% ควรซ่อมการอ่านก่อนปรับความถี่",
  };
  if ((freshPerRun ?? 0) < 0.5 && (hitLimitRate ?? 0) >= 0.8) return {
    level: "warn", freshPerRun, stallRate, hitLimitRate, avgSeconds,
    reason: "ถึง limit เกือบทุกรอบแต่พบโพสต์ใหม่เฉลี่ยต่ำกว่า 0.5 ต่อรอบ",
  };
  if ((stallRate ?? 0) >= 2) return {
    level: "warn", freshPerRun, stallRate, hitLimitRate, avgSeconds,
    reason: "มีเหตุการณ์โหลดค้างเฉลี่ยตั้งแต่ 2 ครั้งต่อรอบ",
  };
  return {
    level: "ok", freshPerRun, stallRate, hitLimitRate, avgSeconds,
    reason: "อัตรารอบสำเร็จและผลตอบแทนการอ่านยังอยู่ในเกณฑ์",
  };
}
