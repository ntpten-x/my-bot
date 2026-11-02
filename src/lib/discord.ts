export type DiscordEmbed = {
  title: string;
  url?: string;
  description?: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp?: string;
};

export function scoreColor(score: number) {
  if (score >= 80) return 0xc2410c;
  if (score >= 50) return 0xd97706;
  return 0x57534e;
}

export function buildLeadEmbed(input: {
  title: string;
  text: string;
  url: string;
  score: number;
  category?: string;
  province?: string | null;
  intent?: string;
  group?: string;
  reply?: string;
}) {
  const intentLabel = input.intent === "buyer" ? "กำลังหา" : input.intent === "seller" ? "กำลังขาย" : "ไม่ชัด";
  const reply = (input.reply || "ยังไม่มีคำตอบแนะนำ").slice(0, 900);
  return {
    title: input.title.slice(0, 200),
    url: input.url,
    description: input.text.replace(/\s+/g, " ").trim().slice(0, 300),
    color: scoreColor(input.score),
    fields: [
      { name: "คะแนน", value: String(input.score), inline: true },
      { name: "หมวด", value: input.category || "อื่นๆ", inline: true },
      { name: "จังหวัด", value: input.province || "-", inline: true },
      { name: "เจตนา", value: intentLabel, inline: true },
      { name: "กลุ่ม", value: input.group || "-", inline: true },
      { name: "คำตอบแนะนำ", value: `\`\`\`\n${reply}\n\`\`\`` },
    ],
    timestamp: new Date().toISOString(),
  } satisfies DiscordEmbed;
}

export function buildSummaryEmbed(title: string, body: string): DiscordEmbed {
  return {
    title: title.slice(0, 200),
    description: body.slice(0, 4000),
    color: 0x1e6b4a,
    timestamp: new Date().toISOString(),
  };
}

export function discordRetryDelayMs(body: string, attempt: number) {
  let retryAfter = 1;
  try {
    const parsed = JSON.parse(body) as { retry_after?: number };
    if (typeof parsed.retry_after === "number" && parsed.retry_after > 0) retryAfter = parsed.retry_after;
  } catch {
    retryAfter = 1;
  }
  return Math.min(retryAfter * 1000 * 1.5 ** Math.max(0, attempt), 20_000);
}

type Queued = { embed: DiscordEmbed; resolve: (result: { ok: boolean; skipped?: boolean; message: string }) => void };

const queues = new Map<string, Queued[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

async function postDiscord(webhook: string, body: unknown, attempt = 0): Promise<{ ok: boolean; message: string }> {
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 429 && attempt < 4) {
    const text = await response.text();
    await new Promise((resolve) => setTimeout(resolve, discordRetryDelayMs(text, attempt)));
    return postDiscord(webhook, body, attempt + 1);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false, message: `Discord ${response.status} ${text.replace(/\s+/g, " ").slice(0, 180)}` };
  }
  return { ok: true, message: "ส่ง Discord แล้ว" };
}

async function flushDiscord(webhook: string) {
  const waiting = queues.get(webhook) ?? [];
  queues.set(webhook, []);
  timers.delete(webhook);
  if (!waiting.length) return;
  const embeds = waiting.slice(0, 10).map((item) => item.embed);
  const result = await postDiscord(webhook, { embeds }).catch((error: unknown) => ({
    ok: false,
    message: error instanceof Error ? error.message : "ส่ง Discord ไม่สำเร็จ",
  }));
  for (const item of waiting.slice(0, 10)) item.resolve(result);
  const rest = waiting.slice(10);
  if (rest.length) {
    queues.set(webhook, rest);
    scheduleDiscord(webhook);
  }
}

function scheduleDiscord(webhook: string) {
  if (timers.has(webhook)) return;
  timers.set(
    webhook,
    setTimeout(() => {
      void flushDiscord(webhook);
    }, 1200),
  );
}

export function sendDiscordEmbed(webhook: string, embed: DiscordEmbed) {
  return new Promise<{ ok: boolean; skipped?: boolean; message: string }>((resolve) => {
    const list = queues.get(webhook) ?? [];
    list.push({ embed, resolve });
    queues.set(webhook, list);
    if (list.length >= 10) {
      const timer = timers.get(webhook);
      if (timer) clearTimeout(timer);
      timers.delete(webhook);
      void flushDiscord(webhook);
      return;
    }
    scheduleDiscord(webhook);
  });
}

export async function sendDiscordContent(webhook: string, content: string) {
  return postDiscord(webhook, { content: content.slice(0, 1900) });
}
