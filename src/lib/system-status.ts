// Pure helpers for the "ภาพรวมระบบ" page: turn raw facts into green / yellow / red cards with Thai hints.
export type Level = "ok" | "warn" | "bad" | "off";

export type Check = {
  key: string;
  label: string;
  level: Level;
  value: string;
  detail?: string;
  hint?: string;
};

export type Section = { id: string; title: string; level: Level; checks: Check[] };

const RANK: Record<Level, number> = { off: 0, ok: 1, warn: 2, bad: 3 };

export function worstLevel(levels: Level[]): Level {
  let worst: Level = "ok";
  let any = false;
  for (const level of levels) {
    if (level === "off") continue;
    any = true;
    if (RANK[level] > RANK[worst]) worst = level;
  }
  return any ? worst : "off";
}

export function section(id: string, title: string, checks: Check[]): Section {
  return { id, title, checks, level: worstLevel(checks.map((check) => check.level)) };
}

export function tabLifecycleCheck(raw: string | undefined, expectedVersion: string, now = Date.now()): Check {
  const check: Check = { key: "ext-tab-lifecycle", label: "แท็บบอท (อุปกรณ์ที่รายงานล่าสุด)", level: "off",
    value: "รอข้อมูลแท็บจากส่วนขยายรุ่นปัจจุบัน", detail: "ไม่มีข้อมูลสดไม่ได้หมายความว่าไม่มีแท็บค้าง" };
  try {
    const tabs = JSON.parse(raw || "null");
    if (!tabs || tabs.version !== expectedVersion) return check;
    const age = now - Date.parse(tabs.at);
    if (!Number.isFinite(age) || age < 0 || age >= 180_000 ||
      !["activeReaders", "activeComments", "parkedReaders", "closing", "idleReaders", "released"].every(key => Number.isInteger(tabs[key]) && tabs[key] >= 0)) return check;
    return { ...check, level: tabs.closing || tabs.idleReaders ? "warn" : "ok",
      value: `กำลังอ่าน ${tabs.activeReaders} · คอมเมนต์ ${tabs.activeComments} · รออ่านต่อ ${tabs.parkedReaders} · รอปิด ${tabs.closing}`,
      detail: `รอเก็บกวาด ${tabs.idleReaders} · คืนให้เจ้าของแล้ว ${tabs.released} (ในเซสชันนี้)`,
      hint: tabs.closing ? "Chrome ยังไม่ยืนยันการปิด ระบบจะลองใหม่ ไม่ต้องเริ่มส่งคอมเมนต์เดิมซ้ำ"
        : "งานเสร็จปิดแท็บทันที แท็บรออ่านต่อจะปิดเมื่อพักเกิน 5 นาที หรือสั่งเก็บกวาดจากป๊อปอัป โดยยังเก็บข้อมูลกู้คืนและไม่ปิดแท็บส่วนตัว" };
  } catch { return check; }
}

export function ageMs(iso: string | Date | null | undefined, now = Date.now()) {
  if (!iso) return null;
  const time = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  return Number.isNaN(time) ? null : Math.max(0, now - time);
}

export function thaiAgo(ms: number | null) {
  if (ms == null) return "ไม่เคย";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  return `${Math.floor(hours / 24)} วันที่แล้ว`;
}

export function thaiDuration(ms: number) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ชม. ${minutes % 60} นาที`;
  return `${Math.floor(hours / 24)} วัน ${hours % 24} ชม.`;
}

// Extension sends a heartbeat every minute.
export const HEARTBEAT_OK_MS = 3 * 60 * 1000;
export const HEARTBEAT_WARN_MS = 30 * 60 * 1000;

export function heartbeatLevel(lastSeen: string | Date | null | undefined, now = Date.now()): Level {
  const age = ageMs(lastSeen, now);
  if (age == null) return "bad";
  if (age <= HEARTBEAT_OK_MS) return "ok";
  if (age <= HEARTBEAT_WARN_MS) return "warn";
  return "bad";
}

// Worker writes worker_last_tick once a minute.
export function workerLevel(lastTick: string | null | undefined, now = Date.now()): Level {
  const age = ageMs(lastTick, now);
  if (age == null) return "bad";
  if (age <= 3 * 60 * 1000) return "ok";
  if (age <= 10 * 60 * 1000) return "warn";
  return "bad";
}

export function compareVersions(a: string, b: string) {
  const left = String(a || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function versionLevel(actual: string, expected: string): Level {
  if (!actual) return "bad";
  return compareVersions(actual, expected) >= 0 ? "ok" : "warn";
}

// Explain a cloud AI failure in plain Thai.
export function explainAiFailure(status: number | null, rawMessage = "") {
  const message = rawMessage.toLowerCase();
  if (status === 401 || status === 403 || /invalid api key|api key not valid|permission/i.test(message)) {
    return { text: "คีย์ไม่ถูกต้องหรือถูกยกเลิก", hint: "สร้างคีย์ใหม่แล้วใส่ในหน้า ตั้งค่า > AI" };
  }
  if (status === 429 || /rate limit|quota|resource_exhausted/i.test(message)) {
    return { text: "ติดลิมิตการใช้งาน (rate limit / โควตา)", hint: "รอสักพักแล้วจะกลับมาเอง หรือลดความถี่ / เปลี่ยนแพ็กเกจ" };
  }
  if (status === 404 || /not found|does not exist|decommissioned/i.test(message)) {
    return { text: "ไม่พบโมเดลที่ตั้งไว้", hint: "เลือกโมเดลใหม่ในหน้า ตั้งค่า > AI" };
  }
  if (status === 400) return { text: "คำขอไม่ถูกต้อง (HTTP 400)", hint: "ตรวจชื่อโมเดลในหน้า ตั้งค่า > AI" };
  if (status != null && status >= 500) return { text: `ฝั่งผู้ให้บริการขัดข้อง (HTTP ${status})`, hint: "ปกติจะหายเอง ลองใหม่ภายหลัง" };
  if (/timeout|aborted/i.test(message)) return { text: "หมดเวลารอคำตอบ", hint: "ตรวจอินเทอร์เน็ตของเครื่อง" };
  if (/fetch failed|enotfound|econnrefused|eai_again|network/i.test(message)) {
    return { text: "เชื่อมต่ออินเทอร์เน็ตไม่ได้", hint: "ตรวจอินเทอร์เน็ต / ไฟร์วอลล์ของเครื่อง" };
  }
  return { text: status ? `ใช้งานไม่ได้ (HTTP ${status})` : "ใช้งานไม่ได้", hint: "กดตรวจใหม่ หรือดูหน้า ตั้งค่า > AI" };
}

// Remove anything that could be a secret before it reaches the page.
export function scrubSecrets(text: string, secrets: string[] = []) {
  let out = String(text || "");
  for (const secret of secrets) if (secret && secret.length >= 6) out = out.split(secret).join("[hidden]");
  return out
    .replace(/([?&](key|token|access_token)=)[^&\s]+/gi, "$1[hidden]")
    .replace(/bearer\s+\S+/gi, "Bearer [hidden]")
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgres://[hidden]")
    .replace(/https:\/\/(discord(app)?\.com)\/api\/webhooks\/\S+/gi, "https://$1/api/webhooks/[hidden]")
    .slice(0, 300);
}

function bangkokParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

// Next time a daily HH:MM job (Bangkok) runs. If today's slot passed but it has not run today, it is due now.
export function nextDailyRun(time: string, lastDay: string | null, now = new Date()) {
  const { day, time: clock } = bangkokParts(now);
  const today = new Date(`${day}T${time}:00+07:00`);
  if (clock < time) return today;
  if (lastDay !== day) return now;
  return new Date(today.getTime() + 86400000);
}

export function nextTimesRun(times: string[], now = new Date()) {
  const sorted = [...times].filter((time) => /^\d{2}:\d{2}$/.test(time)).sort();
  if (!sorted.length) return null;
  const { day, time: clock } = bangkokParts(now);
  const upcoming = sorted.find((time) => time > clock);
  if (upcoming) return new Date(`${day}T${upcoming}:00+07:00`);
  return new Date(new Date(`${day}T${sorted[0]}:00+07:00`).getTime() + 86400000);
}

export function bangkokLabel(date: Date | null) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function supabaseLabel(databaseUrl: string | undefined) {
  try {
    const host = new URL(String(databaseUrl || "")).hostname;
    const region = host.match(/aws-\d+-([a-z]+-[a-z]+-\d+)\.pooler\.supabase\.com/);
    if (region) return `Supabase (${region[1]})`;
    if (/supabase\.(co|com)$/.test(host)) return "Supabase";
    return host === "localhost" || host === "127.0.0.1" ? "Postgres บนเครื่องนี้" : "Postgres";
  } catch {
    return "ยังไม่ได้ตั้ง DATABASE_URL";
  }
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function diskLevel(free: number, total: number): Level {
  if (!total) return "off";
  if (free < 2 * 1024 ** 3 || free / total < 0.05) return "bad";
  if (free < 10 * 1024 ** 3 || free / total < 0.1) return "warn";
  return "ok";
}
