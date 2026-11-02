export type SummaryLead = {
  text: string;
  score: number;
  url: string;
  category: string;
  keywords: string[];
  sourceName: string;
  intent: string;
  isAd: boolean;
};

export function clockMinutes(clock: string) {
  const [hour, minute] = clock.split(":").map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

export function shouldCatchUp(nowTime: string, scheduled: string, lastDay: string | null, today: string) {
  if (lastDay === today) return false;
  return clockMinutes(nowTime) >= clockMinutes(scheduled);
}

export function shouldSendSummary(clockTime: string, configured: string, lastDay: string | null, today: string) {
  return shouldCatchUp(clockTime, configured, lastDay, today);
}

export function bangkokClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { day: `${read("year")}-${read("month")}-${read("day")}`, time: `${read("hour")}:${read("minute")}` };
}

export function buildSummary(day: string, leads: SummaryLead[]) {
  const real = leads.filter((lead) => !lead.isAd);
  const hot = [...real].sort((left, right) => right.score - left.score).slice(0, 5);
  const categories = new Map<string, number>();
  const keywords = new Map<string, number>();
  const groups = new Map<string, { leads: number; hot: number; ads: number }>();
  for (const lead of leads) {
    const group = groups.get(lead.sourceName) ?? { leads: 0, hot: 0, ads: 0 };
    if (lead.isAd) group.ads += 1;
    else {
      group.leads += 1;
      if (lead.score >= 80) group.hot += 1;
      categories.set(lead.category, (categories.get(lead.category) ?? 0) + 1);
      for (const word of lead.keywords) keywords.set(word, (keywords.get(word) ?? 0) + 1);
    }
    groups.set(lead.sourceName, group);
  }
  const topCategories = [...categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topKeywords = [...keywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const ranked = [...groups.entries()].sort((a, b) => b[1].hot - a[1].hot || b[1].leads - a[1].leads);
  const best = ranked[0];
  const worst = [...groups.entries()].sort((a, b) => b[1].ads - a[1].ads || a[1].leads - b[1].leads)[0];
  const lines = [
    `สรุปวันที่ ${day}`,
    `ลีดเมื่อวาน ${real.length} รายการ (ร้อน ${real.filter((lead) => lead.score >= 80).length})`,
    "",
    "ลีดร้อน",
    ...(hot.length
      ? hot.map((lead, index) => `${index + 1}. [${lead.score}] ${lead.text.replace(/\s+/g, " ").slice(0, 80)}\n${lead.url}`)
      : ["ไม่มีลีดร้อน"]),
    "",
    `หมวดที่มาแรง: ${topCategories.map(([name, count]) => `${name} ${count}`).join(", ") || "-"}`,
    `คำที่เจอบ่อย: ${topKeywords.map(([name, count]) => `${name} ${count}`).join(", ") || "-"}`,
    `กลุ่มที่ดีที่สุด: ${best ? `${best[0]} (ร้อน ${best[1].hot})` : "-"}`,
    `กลุ่มที่แผ่วที่สุด: ${worst ? `${worst[0]} (โฆษณา ${worst[1].ads}, ลีด ${worst[1].leads})` : "-"}`,
  ];
  return { title: `สรุป MY-BOT ${day}`, body: lines.join("\n") };
}
