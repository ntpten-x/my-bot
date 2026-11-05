import { prisma, dbErrorStats } from "./prisma";
import { claimOnce } from "./lease";
import { dispatchNotification } from "./notify";
import { getSettings, upsertSettings, type AppSettings } from "./settings";
import { EXTENSION_SOURCE_TYPES } from "./scrape-plan";

export type WatchLevel = "ok" | "warn" | "bad" | "off";
export type WatchCondition = { key: string; label: string; level: WatchLevel; message: string; hint: string };
export type WatchState = Record<string, { level: WatchLevel; label: string; message: string; hint: string; since: string; lastOkAt: string | null }>;

export type WatchFacts = {
  now: number;
  enabledExtensionSources: number;
  lastHeartbeatAt: number | null;
  extensionEnabled: boolean | null;
  extensionErrors24h: number;
  extensionOutbox: number;
  lastExtensionPostAt: number | null;
  parseRecent: { total: number; noAuthor: number; noText: number };
  parseBaseline: { total: number; noAuthor: number; noText: number };
  aiMode: string;
  aiProvidersEnabled: number;
  aiProvidersReady: number;
  oldestPendingAiJobAt: number | null;
  workerLastTickAt: number | null;
  dbTransientErrors: number;
  dbError: string | null;
};

export type WatchThresholds = Pick<AppSettings, "watchNoPostsHours" | "watchExtOfflineMinutes" | "watchParseSpikePct">;

const HOUR = 3600_000;
const ratio = (part: number, total: number) => (total > 0 ? part / total : 0);

/** Pure: turn current facts into watchdog conditions. */
export function assessWatch(facts: WatchFacts, t: WatchThresholds): WatchCondition[] {
  const out: WatchCondition[] = [];
  const add = (key: string, label: string, level: WatchLevel, message: string, hint = "") => out.push({ key, label, level, message, hint });

  if (facts.dbError) {
    add("db", "ฐานข้อมูล", "bad", `ติดต่อฐานข้อมูลไม่ได้: ${facts.dbError.slice(0, 160)}`, "ตรวจอินเทอร์เน็ต/สถานะ Supabase และ DATABASE_URL ระบบจะลองใหม่เองอัตโนมัติ");
  } else if (facts.dbTransientErrors >= 5) {
    add("db", "ฐานข้อมูล", "warn", `การเชื่อมต่อฐานข้อมูลสะดุด ${facts.dbTransientErrors} ครั้งช่วงนี้ (ลองใหม่สำเร็จบางส่วน)`, "มักเกิดจากเน็ตช้าหรือ Supabase pooler แน่น ถ้าเป็นนานให้ตรวจสถานะ Supabase");
  } else add("db", "ฐานข้อมูล", "ok", "เชื่อมต่อปกติ");

  const tickAge = facts.workerLastTickAt ? facts.now - facts.workerLastTickAt : Infinity;
  if (tickAge > 10 * 60_000) add("worker", "ตัวทำงานเบื้องหลัง", "bad", "ตัวทำงานเบื้องหลังไม่ทำงานเกิน 10 นาที", "รีสตาร์ต MY-BOT (start-all) หรือดูบันทึก data/mybot-console.log");
  else add("worker", "ตัวทำงานเบื้องหลัง", "ok", "ทำงานปกติ");

  if (facts.enabledExtensionSources > 0) {
    const offlineMs = facts.lastHeartbeatAt ? facts.now - facts.lastHeartbeatAt : Infinity;
    const online = offlineMs <= t.watchExtOfflineMinutes * 60_000;
    if (!online) {
      add("extension", "ส่วนขยาย Chrome", "bad", facts.lastHeartbeatAt ? `ส่วนขยายออฟไลน์ ${Math.round(offlineMs / 60_000)} นาที` : "ยังไม่เคยได้รับสัญญาณจากส่วนขยาย", "เปิด Chrome ที่ติดตั้งส่วนขยาย ตรวจว่าโทเคนตรงกันและเปิดใช้งานอยู่");
    } else if (facts.extensionEnabled === false) {
      add("extension", "ส่วนขยาย Chrome", "bad", "การดึงอัตโนมัติถูกปิดอยู่ในส่วนขยาย", "เปิดหน้าตั้งค่าส่วนขยายแล้วติ๊ก \"เปิดใช้งาน\"");
    } else if (facts.extensionErrors24h >= 20 || facts.extensionOutbox > 0) {
      add("extension", "ส่วนขยาย Chrome", "warn", `ข้อผิดพลาด 24 ชม. ${facts.extensionErrors24h} ครั้ง, รอส่ง ${facts.extensionOutbox} ชุด`, "ดูบันทึกข้อผิดพลาดของส่วนขยายในหน้าภาพรวม ถ้ารอส่งค้าง ตรวจว่าเซิร์ฟเวอร์ออนไลน์");
    } else add("extension", "ส่วนขยาย Chrome", "ok", "ออนไลน์และเปิดดึงอัตโนมัติ");

    const postAge = facts.lastExtensionPostAt ? facts.now - facts.lastExtensionPostAt : Infinity;
    if (online && facts.extensionEnabled !== false && postAge > t.watchNoPostsHours * HOUR) {
      add("posts", "โพสต์ใหม่", "bad", facts.lastExtensionPostAt ? `ไม่มีโพสต์ใหม่จากกลุ่มที่เปิดไว้ ${Math.round(postAge / HOUR)} ชั่วโมง` : "ยังไม่มีโพสต์จากกลุ่มที่เปิดไว้", "ตรวจว่า Facebook ยังล็อกอินอยู่ และลองกด \"ดึงตอนนี้\" ในส่วนขยาย");
    } else add("posts", "โพสต์ใหม่", "ok", "มีโพสต์เข้ามาตามปกติ");

    const spike = t.watchParseSpikePct / 100;
    const r = facts.parseRecent;
    const b = facts.parseBaseline;
    const textJump = ratio(r.noText, r.total) - ratio(b.noText, b.total);
    const authorJump = ratio(r.noAuthor, r.total) - ratio(b.noAuthor, b.total);
    if (r.total >= 10 && (textJump >= spike || authorJump >= spike)) {
      add("parse", "คุณภาพการอ่านโพสต์", "bad", `โพสต์ล่าสุดขาดข้อความ ${Math.round(ratio(r.noText, r.total) * 100)}% / ขาดชื่อ ${Math.round(ratio(r.noAuthor, r.total) * 100)}% (ปกติ ${Math.round(ratio(b.noText, b.total) * 100)}% / ${Math.round(ratio(b.noAuthor, b.total) * 100)}%)`, "Facebook อาจเปลี่ยนหน้าตา ตรวจตัวอย่างการอ่านในหน้าแหล่งข้อมูล และอัปเดตส่วนขยาย");
    } else add("parse", "คุณภาพการอ่านโพสต์", "ok", r.total ? `อ่านได้ครบ ${r.total} โพสต์ล่าสุด` : "ยังไม่มีโพสต์ช่วงนี้");
  } else {
    add("extension", "ส่วนขยาย Chrome", "off", "ไม่มีกลุ่ม Facebook ที่เปิดใช้งาน");
  }

  if (facts.aiMode === "rules") add("ai", "AI จัดหมวด", "off", "ใช้กฎอย่างเดียว (ไม่ใช้ AI)");
  else if (facts.aiProvidersEnabled === 0) add("ai", "AI จัดหมวด", "bad", "ไม่มีผู้ให้บริการ AI ที่เปิดใช้งาน", "เพิ่มโมเดลและคีย์ในหน้า ตั้งค่า → ผู้ให้บริการ AI");
  else if (facts.aiProvidersReady === 0) add("ai", "AI จัดหมวด", "bad", "ผู้ให้บริการ AI ทั้งหมดกำลังพัก (โควตาเต็ม/ผิดพลาด)", "รอให้โควตารีเซ็ต หรือเพิ่มคีย์/ผู้ให้บริการสำรอง งานจะรอคิวไว้ไม่หาย");
  else if (facts.oldestPendingAiJobAt && facts.now - facts.oldestPendingAiJobAt > HOUR) add("ai", "AI จัดหมวด", "warn", `มีงาน AI ค้างคิวเกิน ${Math.round((facts.now - facts.oldestPendingAiJobAt) / HOUR)} ชั่วโมง`, "AI อาจช้าหรือโดนจำกัด เพิ่มผู้ให้บริการสำรองจะช่วยได้");
  else add("ai", "AI จัดหมวด", "ok", `พร้อม ${facts.aiProvidersReady}/${facts.aiProvidersEnabled} ผู้ให้บริการ`);

  return out;
}

/** Pure: merge new conditions into the saved state (keeps since / lastOkAt). */
export function mergeWatchState(previous: WatchState, conditions: WatchCondition[], now: number): WatchState {
  const iso = new Date(now).toISOString();
  const next: WatchState = {};
  for (const c of conditions) {
    const prev = previous[c.key];
    next[c.key] = {
      level: c.level, label: c.label, message: c.message, hint: c.hint,
      since: prev && prev.level === c.level ? prev.since : iso,
      lastOkAt: c.level === "ok" ? iso : prev?.lastOkAt ?? null,
    };
  }
  return next;
}

export function parseWatchState(raw: string | undefined | null): WatchState {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? (value as WatchState) : {};
  } catch {
    return {};
  }
}

let lastDbTransient = 0;

async function collectFacts(now: number, settings: AppSettings): Promise<WatchFacts> {
  const types = [...EXTENSION_SOURCE_TYPES] as string[];
  const recentSince = new Date(now - 12 * HOUR);
  const baseSince = new Date(now - 7 * 24 * HOUR);
  const parseQuery = (from: Date, to: Date) => prisma.$queryRaw<{ total: number; noauthor: number; notext: number }[]>`
    SELECT count(*)::int AS total,
      coalesce(sum(CASE WHEN p."authorName" = '' THEN 1 ELSE 0 END), 0)::int AS noauthor,
      coalesce(sum(CASE WHEN length(trim(p."text")) < 5 THEN 1 ELSE 0 END), 0)::int AS notext
    FROM "Post" p JOIN "Source" s ON s."id" = p."sourceId"
    WHERE s."type"::text = ANY(${types}::text[]) AND p."createdAt" >= ${from} AND p."createdAt" < ${to}`;
  const [enabledSources, heartbeat, lastPost, recent, base, providers, pending, tick] = await Promise.all([
    prisma.source.count({ where: { type: { in: [...EXTENSION_SOURCE_TYPES] }, enabled: true } }),
    prisma.extensionHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } }),
    prisma.post.findFirst({ where: { source: { type: { in: [...EXTENSION_SOURCE_TYPES] } } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    parseQuery(recentSince, new Date(now + 60_000)),
    parseQuery(baseSince, recentSince),
    prisma.aiProvider.findMany({ where: { enabled: true }, select: { cooldownUntil: true } }),
    prisma.aiJob.findFirst({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.setting.findUnique({ where: { key: "worker_last_tick" } }),
  ]);
  const legacySeen = await prisma.setting.findUnique({ where: { key: "extension_last_seen" } });
  const seenTimes = [heartbeat?.lastSeenAt?.getTime() ?? 0, legacySeen?.value ? new Date(legacySeen.value).getTime() || 0 : 0];
  const lastSeen = Math.max(...seenTimes);
  const transientDelta = dbErrorStats.transient - lastDbTransient;
  lastDbTransient = dbErrorStats.transient;
  const tickAt = tick?.value ? new Date(tick.value).getTime() : NaN;
  const pick = (rows: { total: number; noauthor: number; notext: number }[]) => ({ total: rows[0]?.total ?? 0, noAuthor: rows[0]?.noauthor ?? 0, noText: rows[0]?.notext ?? 0 });
  return {
    now,
    enabledExtensionSources: enabledSources,
    lastHeartbeatAt: lastSeen || null,
    extensionEnabled: heartbeat ? heartbeat.enabled : null,
    extensionErrors24h: heartbeat?.errorCount24h ?? 0,
    extensionOutbox: heartbeat?.outboxSize ?? 0,
    lastExtensionPostAt: lastPost?.createdAt.getTime() ?? null,
    parseRecent: pick(recent),
    parseBaseline: pick(base),
    aiMode: settings.aiProvider,
    aiProvidersEnabled: providers.length,
    aiProvidersReady: providers.filter((row) => !row.cooldownUntil || row.cooldownUntil.getTime() <= now).length,
    oldestPendingAiJobAt: pending?.createdAt.getTime() ?? null,
    workerLastTickAt: Number.isFinite(tickAt) ? tickAt : null,
    dbTransientErrors: Math.max(0, transientDelta),
    dbError: null,
  };
}

async function alert(settings: AppSettings, condition: WatchCondition) {
  await dispatchNotification(
    {
      id: null,
      text: `${condition.label}: ${condition.message}${condition.hint ? `\nวิธีแก้: ${condition.hint}` : ""}`,
      externalUrl: "http://localhost:8001/overview",
      intent: "unknown",
      province: null,
      category: { name: "ระบบ" },
      source: { name: "MY-BOT" },
    },
    settings,
    "ระบบผิดปกติ",
    { external: true, forceExternal: true },
  );
}

let lastRunAt = 0;
let dbDownAlertAt = 0;

/** Leader-only step (every 5 min): persist watchdog_state and alert once per window per problem. */
export async function runWatchdog(now = Date.now()) {
  if (now - lastRunAt < 5 * 60_000) return;
  lastRunAt = now;
  let settings: AppSettings;
  try {
    settings = await getSettings();
  } catch (error) {
    // DB down: nothing can be stored or sent through the DB; just log (throttled).
    if (now - dbDownAlertAt > HOUR) {
      dbDownAlertAt = now;
      console.error(`[watchdog] database unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }
  let facts: WatchFacts;
  try {
    facts = await collectFacts(now, settings);
  } catch (error) {
    console.error(`[watchdog] collect failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const conditions = assessWatch(facts, settings);
  const previous = parseWatchState((await prisma.setting.findUnique({ where: { key: "watchdog_state" } }))?.value);
  const state = mergeWatchState(previous, conditions, now);
  await upsertSettings({ watchdog_state: JSON.stringify(state), watchdog_checked_at: new Date(now).toISOString() });
  if (!settings.watchEnabled) return;
  const bucket = Math.floor(now / (settings.watchAlertEveryHours * HOUR));
  for (const condition of conditions) {
    if (condition.level !== "bad") continue;
    // Give a brand-new problem one run to clear before alerting (avoids flapping).
    if (previous[condition.key]?.level !== "bad") continue;
    if (!(await claimOnce(`watch:${condition.key}:${bucket}`))) continue;
    await alert(settings, condition).catch((error) => console.error(`[watchdog] alert failed: ${error instanceof Error ? error.message : String(error)}`));
  }
}