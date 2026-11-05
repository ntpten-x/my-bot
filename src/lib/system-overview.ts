import { statfs, stat, access } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";
import { getSettings, type AppSettings } from "./settings";
import { bangkokStart } from "./format";
import { APP_VERSION } from "./version";
import { aiQueueStats } from "./ai/stats";
import { resolveOllamaBaseUrl } from "./ai/ollama-url";
import { liveTestProvider } from "./ai/live-test";
import { EXPECTED_EXTENSION_VERSION } from "./extension-heartbeat";
import { EXTENSION_SOURCE_TYPES, PRIORITY_LABEL, maxIntervalFor, normalizePriority } from "./scrape-plan";
import { STOP_REASON_LABEL, readerHealth } from "./scrape-runs";
import { coverageBySource } from "./coverage-data";
import type { Coverage } from "./coverage";
import { parseWatchState } from "./watchdog";
import { classificationStats } from "./classification-stats";
import {
  ageMs,
  bangkokLabel,
  diskLevel,
  formatBytes,
  heartbeatLevel,
  nextDailyRun,
  nextTimesRun,
  scrubSecrets,
  section,
  supabaseLabel,
  thaiAgo,
  thaiDuration,
  versionLevel,
  workerLevel,
  worstLevel,
  type Check,
  type Level,
} from "./system-status";

const DAY_MS = 86400000;

export type AccountRow = {
  id: string;
  name: string;
  loggedIn: boolean;
  lastSeenAt: string;
  browser: string;
  profileLabel: string;
  postsCaptured: number;
  firstSeenAt: string;
};

export type ScrapeRow = {
  id: string;
  name: string;
  kind: "group" | "marketplace";
  enabled: boolean;
  priority: "high" | "normal" | "low";
  intervalMinutes: number;
  currentIntervalMinutes: number;
  maxIntervalMinutes: number;
  lastRunAt: string | null;
  lastRunFound: number;
  lastRunNew: number;
  lastRunStop: string;
  nextRunAt: string | null;
  lastError: string;
  coverage: Coverage | null;
};

export type InstallRow = {
  id: string;
  version: string;
  browser: string;
  profileLabel: string;
  enabled: boolean;
  level: Level;
  lastSeenAt: string;
  fbLoggedIn: boolean;
  fbUserId: string | null;
  fbUserName: string;
  tabs: { title: string; url: string }[];
  lastError: string;
  lastErrorAt: string | null;
  lastPostAt: string | null;
  postsSent: number;
  errorCount24h: number;
  errorLog: { at: number; message: string; count: number }[];
  outboxSize: number;
};

function secretsOf(settings: AppSettings) {
  return [
    settings.groqApiKey,
    settings.geminiApiKey,
    settings.discordWebhook,
    settings.lineToken,
    settings.extensionToken,
    settings.smtpPass,
    process.env.DATABASE_URL ?? "",
    process.env.DIRECT_URL ?? "",
  ].filter(Boolean);
}

async function readSettingsMap(keys: string[]) {
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, string | undefined>;
}

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function ollamaStatus(settings: AppSettings) {
  try {
    const base = await resolveOllamaBaseUrl(settings.ollamaBaseUrl);
    const started = performance.now();
    const tags = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const latencyMs = Math.round(performance.now() - started);
    if (!tags.ok) return { reachable: false, latencyMs, installed: [] as string[], loaded: [] as string[], port: new URL(base).port, error: `HTTP ${tags.status}` };
    const installed = ((await tags.json()).models ?? []).map((model: { name?: string }) => String(model.name ?? "")).filter(Boolean) as string[];
    const ps = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
    const loaded = ps?.ok ? (((await ps.json()).models ?? []) as { name?: string }[]).map((model) => String(model.name ?? "")).filter(Boolean) : [];
    return { reachable: true, latencyMs, installed, loaded, port: new URL(base).port, error: "" };
  } catch (error) {
    return { reachable: false, latencyMs: null, installed: [] as string[], loaded: [] as string[], port: "", error: error instanceof Error ? error.message : "เชื่อมต่อไม่ได้" };
  }
}

function hasModel(list: string[], model: string) {
  return list.some((item) => item === model || item === `${model}:latest` || item.startsWith(`${model}:`) || (model.includes(":") && item === model));
}

export async function collectSystemOverview(options: { fresh?: boolean } = {}) {
  const now = Date.now();
  const settings = await getSettings();
  const secrets = secretsOf(settings);
  const clean = (text: string) => scrubSecrets(text, secrets);
  const todayStart = bangkokStart(0);
  const since24h = new Date(now - DAY_MS);

  const dbStarted = performance.now();
  const dbOk = await prisma
    .$queryRaw`SELECT 1`
    .then(() => true)
    .catch(() => false);
  const dbLatencyMs = Math.round(performance.now() - dbStarted);

  if (!dbOk) {
    const checks: Check[] = [
      {
        key: "db",
        label: "ฐานข้อมูล",
        level: "bad",
        value: "เชื่อมต่อไม่ได้",
        detail: supabaseLabel(process.env.DATABASE_URL),
        hint: "ตรวจอินเทอร์เน็ต และสถานะโปรเจกต์ใน Supabase (โปรเจกต์ฟรีอาจถูกพักถ้าไม่ได้ใช้นาน) ส่วนอื่นจะแสดงได้เมื่อฐานข้อมูลกลับมา",
      },
    ];
    return {
      generatedAt: new Date(now).toISOString(),
      overall: "bad" as Level,
      counts: { ok: 0, warn: 0, bad: 1, off: 0 } as Record<Level, number>,
      sections: [section("system", "ระบบอื่น ๆ", checks)],
      facebook: { loggedIn: null as boolean | null, accountCount: 0, loggedInCount: 0, accounts: [] as AccountRow[] },
      extension: { expectedVersion: EXPECTED_EXTENSION_VERSION, installs: [] as InstallRow[], openTabs: [] as { title: string; url: string }[] },
      scrape: [] as ScrapeRow[],
    };
  }

  const keys = [
    "worker_last_tick",
    "worker_started_at",
    "summary_last_day",
    "backup_last_day",
    "reply_queue_last_slot",
    "extension_last_seen",
    "extension_bad_token_at",
    "notify_last_discord",
    "notify_last_line",
    "notify_last_email",
    "watchdog_state",
    "watchdog_checked_at",
    "worker_leader",
  ];
  const [map, accounts, installs, facebookSources, postsToday, leadsToday, lastFbPost, fbErrors24h, aiQueue, failed24h, doneJobs, ollama, groq, gemini] =
    await Promise.all([
      readSettingsMap(keys),
      prisma.fbAccount.findMany({ orderBy: { lastSeenAt: "desc" } }),
      prisma.extensionHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 10 }),
      prisma.source.findMany({ where: { type: { in: [...EXTENSION_SOURCE_TYPES] } }, orderBy: { name: "asc" } }),
      prisma.post.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.post.count({ where: { createdAt: { gte: todayStart }, intent: "buyer", isAd: false, forbiddenHit: false, duplicateOfId: null } }),
      prisma.post.findFirst({ where: { source: { type: { in: [...EXTENSION_SOURCE_TYPES] } } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, source: { select: { name: true } } } }),
      prisma.fetchLog.findMany({
        where: { status: "error", createdAt: { gte: since24h }, source: { type: { in: [...EXTENSION_SOURCE_TYPES] } } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { source: { select: { name: true } } },
      }),
      aiQueueStats(),
      prisma.aiJob.count({ where: { status: "failed", updatedAt: { gte: since24h } } }),
      prisma.aiJob.findMany({ where: { status: "done", updatedAt: { gte: since24h } }, select: { post: { select: { aiProvider: true } } }, take: 3000 }),
      ollamaStatus(settings),
      liveTestProvider("groq", settings, options.fresh),
      liveTestProvider("gemini", settings, options.fresh),
    ]);

  // ---------- Facebook accounts ----------
  const activeInstalls = installs.filter((row) => heartbeatLevel(row.lastSeenAt, now) !== "bad");
  const loggedInIds = new Set(activeInstalls.filter((row) => row.fbLoggedIn && row.fbUserId).map((row) => row.fbUserId as string));
  const anyRecentIdentity = activeInstalls.some((row) => row.fbCheckedAt);
  const facebookLoggedIn: boolean | null = activeInstalls.length ? (loggedInIds.size > 0 ? true : anyRecentIdentity ? false : null) : null;
  const accountRows: AccountRow[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    loggedIn: loggedInIds.has(account.id),
    lastSeenAt: account.lastSeenAt.toISOString(),
    browser: account.browser,
    profileLabel: account.profileLabel,
    postsCaptured: account.postsCaptured,
    firstSeenAt: account.firstSeenAt.toISOString(),
  }));
  const fbChecks: Check[] = [
    {
      key: "fb-login",
      label: "ล็อกอิน Facebook ในเบราว์เซอร์",
      level: facebookLoggedIn === true ? "ok" : facebookLoggedIn === false ? "bad" : "warn",
      value: facebookLoggedIn === true ? "ล็อกอินแล้ว" : facebookLoggedIn === false ? "ยังไม่ได้ล็อกอิน" : "ยังไม่ทราบ",
      detail:
        facebookLoggedIn === null
          ? activeInstalls.length
            ? "ส่วนขยายยังไม่ได้เห็นหน้า Facebook เลยตั้งแต่เปิดเบราว์เซอร์"
            : "ยังไม่มีสัญญาณจากส่วนขยาย"
          : `${loggedInIds.size} บัญชีที่ล็อกอินอยู่ตอนนี้`,
      hint:
        facebookLoggedIn === true
          ? undefined
          : facebookLoggedIn === false
            ? "เปิด facebook.com ในเบราว์เซอร์ที่ติดตั้งส่วนขยาย แล้วล็อกอิน"
            : "เปิดแท็บ facebook.com สักครั้ง (ส่วนขยายต้องเป็นเวอร์ชัน 1.3.0 ขึ้นไป)",
    },
    {
      key: "fb-accounts",
      label: "จำนวนบัญชี Facebook ที่เคยเห็น",
      level: accountRows.length ? "ok" : "off",
      value: `${accountRows.length} บัญชี`,
      detail: accountRows.length ? accountRows.map((row) => `${row.name || "ไม่ทราบชื่อ"} (${row.id})`).join(", ") : "ยังไม่มีข้อมูล",
    },
  ];

  // ---------- Extension ----------
  const lastSeenSetting = map.extension_last_seen ?? null;
  const newest = installs[0] ?? null;
  const connectionAt = newest?.lastSeenAt.toISOString() ?? lastSeenSetting;
  const connLevel = heartbeatLevel(connectionAt, now);
  const badTokenAt = map.extension_bad_token_at ?? null;
  const badTokenRecent = (ageMs(badTokenAt, now) ?? Infinity) < 30 * 60 * 1000;
  const goodRecent = (ageMs(connectionAt, now) ?? Infinity) < 30 * 60 * 1000;
  const enabledFb = facebookSources.filter((source) => source.enabled);
  const openTabs = activeInstalls.flatMap((row) => parseJson<{ title: string; url: string }[]>(row.tabsJson, []));
  const lastErrors = activeInstalls.filter((row) => row.lastError && (ageMs(row.lastErrorAt, now) ?? Infinity) < DAY_MS);
  const extChecks: Check[] = [
    {
      key: "ext-connected",
      label: "ส่วนขยายเชื่อมต่อกับระบบ",
      level: connLevel,
      value: connLevel === "ok" ? "เชื่อมต่ออยู่" : connLevel === "warn" ? "เงียบไปสักพัก" : "ไม่ได้เชื่อมต่อ",
      detail: `สัญญาณล่าสุด ${thaiAgo(ageMs(connectionAt, now))}`,
      hint:
        connLevel === "ok"
          ? undefined
          : "เปิด Chrome ที่ติดตั้ง MY-BOT Lead Radar ไว้ ตรวจว่าเปิดใช้งานอยู่ที่ chrome://extensions และใส่ที่อยู่ http://localhost:8001 กับโทเคนในป๊อปอัปของส่วนขยายแล้ว",
    },
    {
      key: "ext-version",
      label: "เวอร์ชันส่วนขยาย",
      level: newest ? versionLevel(newest.version, EXPECTED_EXTENSION_VERSION) : lastSeenSetting ? "warn" : "off",
      value: newest ? `v${newest.version || "?"}` : lastSeenSetting ? "เวอร์ชันเก่า (ก่อน 1.3.0)" : "ไม่ทราบ",
      detail: `ระบบต้องการ v${EXPECTED_EXTENSION_VERSION}`,
      hint:
        newest && versionLevel(newest.version, EXPECTED_EXTENSION_VERSION) === "ok"
          ? undefined
          : "เปิด chrome://extensions แล้วกดปุ่มรีโหลด (↻) ที่ MY-BOT Lead Radar",
    },
    {
      key: "ext-token",
      label: "โทเคนส่วนขยาย",
      level: !settings.extensionToken ? "bad" : badTokenRecent && !goodRecent ? "bad" : badTokenRecent ? "warn" : goodRecent ? "ok" : "off",
      value: !settings.extensionToken
        ? "ยังไม่ได้สร้างโทเคน"
        : badTokenRecent && !goodRecent
          ? "โทเคนไม่ถูกต้อง"
          : goodRecent
            ? "ถูกต้อง"
            : "ตั้งค่าแล้ว (ยังไม่มีสัญญาณยืนยัน)",
      detail: badTokenRecent ? `มีการเรียกด้วยโทเคนผิดเมื่อ ${thaiAgo(ageMs(badTokenAt, now))}` : undefined,
      hint: !settings.extensionToken || badTokenRecent ? "คัดลอกโทเคนจากหน้า ตั้งค่า แล้ววางในป๊อปอัปของส่วนขยาย กดบันทึก" : undefined,
    },
    {
      key: "ext-reading",
      label: "กำลังอ่านกลุ่ม",
      level: enabledFb.length ? (activeInstalls.some((row) => row.enabled) || !newest ? "ok" : "bad") : "off",
      value: `${enabledFb.length} กลุ่ม/Marketplace ที่เปิดไว้ · แท็บ Facebook ที่เปิดอยู่ ${openTabs.length} แท็บ`,
      detail: enabledFb.length ? enabledFb.slice(0, 8).map((source) => source.name).join(", ") : "ยังไม่ได้เพิ่มกลุ่ม Facebook หรือ Marketplace",
      hint: newest && !activeInstalls.some((row) => row.enabled) && enabledFb.length ? "ส่วนขยายถูกพักไว้ — ติ๊ก “ดึงข้อมูลอัตโนมัติเบื้องหลัง” ในป๊อปอัปของส่วนขยาย" : "อ่านเองอยู่เบื้องหลังในหน้าต่าง Chrome แยกที่ย่อไว้ (minimized) ไม่เปิดแท็บในหน้าต่างของคุณและไม่แย่งโฟกัส — ปิดได้ ระบบจะสร้างใหม่แบบย่อไว้เอง",
    },
    await (async () => {
      const r = await readerHealth(new Date(now)).catch(() => null);
      const stallPct = r && r.minimized ? r.stalledMinimized / r.minimized : 0;
      return {
        key: "ext-reader-health",
        label: "การอ่านในหน้าต่างย่อ (24 ชม.)",
        level: (!r || !r.total ? "off" : stallPct >= 0.3 || r.throttled > 0 ? "warn" : "ok") as "ok" | "warn" | "off",
        value: r && r.total ? `${r.total} รอบ · ย่ออยู่ ${r.minimized} · ค้าง ${r.stalled} (ขณะย่อ ${r.stalledMinimized}) · รีโหลดซ้ำ ${r.reloaded} · หน่วง ${r.throttled}` : "ยังไม่มีข้อมูล",
        detail: r && r.total ? `อ่านข้อความเต็มสำเร็จ ${r.fullOk}/${r.fullTried} · เฉลี่ย ${r.avgSeconds} วินาที/รอบ` : "บันทึกจากส่วนขยาย v1.8.1 ขึ้นไป",
        hint: r && stallPct >= 0.3 ? "Chrome หน่วงหน้าต่างที่ย่อไว้บ่อย — ระบบจะลดจำนวนกลุ่มต่อรอบเองและเก็บย้อนหลังในรอบกวาด" : undefined,
      };
    })(),
    {
      key: "ext-last-post",
      label: "โพสต์ล่าสุดที่ได้รับจาก Facebook",
      level: lastFbPost ? ((ageMs(lastFbPost.createdAt, now) ?? Infinity) < DAY_MS ? "ok" : "warn") : enabledFb.length ? "warn" : "off",
      value: lastFbPost ? thaiAgo(ageMs(lastFbPost.createdAt, now)) : "ยังไม่เคยได้รับ",
      detail: lastFbPost?.source?.name ? `จาก ${lastFbPost.source.name}` : undefined,
    },
    {
      key: "ext-errors",
      label: "ข้อผิดพลาด 24 ชม.",
      level: lastErrors.length || fbErrors24h.length ? "warn" : "ok",
      value: lastErrors.length || fbErrors24h.length ? `${lastErrors.length + fbErrors24h.length} รายการ` : "ไม่มี",
      detail: [
        ...lastErrors.map((row) => clean(row.lastError)),
        ...fbErrors24h.map((log) => `${log.source?.name ?? "กลุ่ม"}: ${clean(log.message)}`),
      ]
        .slice(0, 4)
        .join(" · ") || undefined,
    },
  ];
  const installRows: InstallRow[] = installs.map((row) => ({
    id: row.id.slice(0, 8),
    version: row.version,
    browser: row.browser,
    profileLabel: row.profileLabel,
    enabled: row.enabled,
    level: heartbeatLevel(row.lastSeenAt, now),
    lastSeenAt: row.lastSeenAt.toISOString(),
    fbLoggedIn: row.fbLoggedIn,
    fbUserId: row.fbUserId,
    fbUserName: row.fbUserName,
    tabs: parseJson<{ title: string; url: string }[]>(row.tabsJson, []).slice(0, 10),
    lastError: clean(row.lastError),
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    lastPostAt: row.lastPostAt?.toISOString() ?? null,
    postsSent: row.postsSent,
    errorCount24h: row.errorCount24h ?? 0,
    errorLog: parseJson<{ at: number; message: string; count: number }[]>(row.errorLogJson ?? "[]", [])
      .slice(0, 10)
      .map((entry) => ({ at: Number(entry.at) || 0, message: clean(String(entry.message || "")), count: Number(entry.count) || 1 })),
    outboxSize: row.outboxSize ?? 0,
  }));

  // ---------- Per-source scrape stats ----------
  const coverage = await coverageBySource(facebookSources.filter((source) => source.enabled), new Date(now));
  const scrapeRows: ScrapeRow[] = facebookSources.map((source) => ({
    coverage: coverage.get(source.id) ?? null,
    id: source.id,
    name: source.name,
    kind: source.type === "facebook_marketplace" ? "marketplace" : "group",
    enabled: source.enabled,
    priority: normalizePriority(source.priority),
    intervalMinutes: source.intervalMinutes,
    currentIntervalMinutes: source.currentIntervalMinutes || source.intervalMinutes,
    maxIntervalMinutes: maxIntervalFor(source.intervalMinutes),
    lastRunAt: source.lastRunAt?.toISOString() ?? null,
    lastRunFound: source.lastRunFound,
    lastRunNew: source.lastRunNew,
    lastRunStop: source.lastRunStop,
    nextRunAt: source.nextRunAt?.toISOString() ?? null,
    lastError: clean(source.lastError ?? ""),
  }));
  const scrapeChecks: Check[] = facebookSources.length
    ? facebookSources.slice(0, 20).map((source) => {
        const interval = source.currentIntervalMinutes || source.intervalMinutes;
        const overdueMs = source.nextRunAt ? now - source.nextRunAt.getTime() : 0;
        const cov = coverage.get(source.id);
        const level: Level = !source.enabled
          ? "off"
          : cov?.level === "bad"
            ? "bad"
            : source.lastRunStop === "error" || overdueMs > Math.max(15, interval * 2) * 60_000 || cov?.level === "warn"
              ? "warn"
              : "ok";
        const next = !source.enabled
          ? "ปิดอยู่"
          : !source.nextRunAt || overdueMs >= 0
            ? "ถึงรอบแล้ว"
            : `อีก ${Math.max(1, Math.round(-overdueMs / 60000))} นาที`;
        return {
          key: `scrape-${source.id}`,
          label: `${source.type === "facebook_marketplace" ? "Marketplace" : "กลุ่ม"}: ${source.name}`,
          level,
          value: (cov && source.enabled ? `ความครบ: ${cov.label} · ` : "") + (source.lastRunAt ? `ใหม่ ${source.lastRunNew} จาก ${source.lastRunFound} · ${thaiAgo(ageMs(source.lastRunAt, now))}` : "ยังไม่มีรอบอ่านแบบใหม่"),
          detail: `สำคัญ${PRIORITY_LABEL[normalizePriority(source.priority)]} · ตอนนี้ทุก ${Math.round(interval * 10) / 10} นาที (ตั้งไว้ ${source.intervalMinutes}) · รอบถัดไป ${next}${source.lastRunStop ? ` · หยุดเพราะ${STOP_REASON_LABEL[source.lastRunStop] ?? source.lastRunStop}` : ""}`,
          hint: cov?.reasons.length && source.enabled ? cov.reasons.join(" · ") : level === "warn" ? (source.lastError ? clean(source.lastError) : "เลยรอบมานาน ตรวจว่า Chrome และส่วนขยายเปิดอยู่") : undefined,
        };
      })
    : [{ key: "scrape-none", label: "แหล่งที่ส่วนขยายอ่าน", level: "off" as Level, value: "ยังไม่ได้เพิ่มกลุ่มหรือ Marketplace" }];

  // ---------- AI ----------
  const usage: Record<string, number> = {};
  for (const job of doneJobs) {
    const name = job.post?.aiProvider || "rules";
    usage[name] = (usage[name] ?? 0) + 1;
  }
  const usageText = Object.entries(usage)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} ${count}`)
    .join(" · ");
  const topProvider = Object.entries(usage).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const pending = Number(aiQueue.counts.pending ?? 0) + Number(aiQueue.counts.processing ?? 0);
  const chatModelReady = hasModel(ollama.installed, settings.ollamaModel);
  const embedReady = hasModel(ollama.installed, settings.embedModel);
  const cloudCheck = (name: string, label: string, test: Awaited<ReturnType<typeof liveTestProvider>>): Check => ({
    key: `ai-${name}`,
    label,
    level: !test.configured ? "off" : test.ok ? (test.latencyMs != null && test.latencyMs > 8000 ? "warn" : "ok") : "bad",
    value: !test.configured ? "ยังไม่ได้ใส่คีย์" : test.ok ? `ใช้งานได้ · ${test.latencyMs} ms` : test.message,
    detail: `คีย์: ${test.configured ? "ตั้งค่าแล้ว (ซ่อนไว้)" : "ไม่มี"} · โมเดล ${test.model}${test.testedAt ? ` · ทดสอบ ${thaiAgo(ageMs(test.testedAt, now))}` : ""}`,
    hint: test.ok ? undefined : test.hint,
  });
  const aiChecks: Check[] = [
    {
      key: "ai-ollama",
      label: "Ollama (AI ในเครื่อง)",
      level: !ollama.reachable ? (settings.aiProvider === "ollama" ? "bad" : "warn") : chatModelReady ? "ok" : "warn",
      value: ollama.reachable ? `ทำงานอยู่ · ${ollama.latencyMs} ms` : "ติดต่อไม่ได้",
      detail: ollama.reachable
        ? `โหลดอยู่ในหน่วยความจำ: ${ollama.loaded.length ? ollama.loaded.join(", ") : "ไม่มี (จะโหลดเมื่อใช้งาน)"} · ติดตั้งแล้ว: ${ollama.installed.join(", ") || "-"}`
        : clean(ollama.error),
      hint: !ollama.reachable
        ? "เปิดโปรแกรม Ollama ในเครื่อง (ไอคอนลามะที่ถาด) แล้วรอสักครู่"
        : chatModelReady
          ? undefined
          : `ยังไม่มีโมเดล ${settings.ollamaModel} — สั่ง ollama pull ${settings.ollamaModel}`,
    },
    {
      key: "ai-embed",
      label: "โมเดลฝังความหมาย (embedding)",
      level: !ollama.reachable ? "warn" : embedReady ? (settings.embedLastAt && !settings.embedLastOk ? "warn" : "ok") : "warn",
      value: `${settings.embedModel} ${embedReady ? "พร้อม" : ollama.reachable ? "ยังไม่ได้ติดตั้ง" : "ตรวจไม่ได้"}`,
      detail: settings.embedLastMessage ? clean(settings.embedLastMessage) : undefined,
      hint: embedReady || !ollama.reachable ? undefined : `สั่ง ollama pull ${settings.embedModel}`,
    },
    cloudCheck("groq", "Groq (AI บนคลาวด์)", groq),
    cloudCheck("gemini", "Gemini (AI บนคลาวด์)", gemini),
    {
      key: "ai-in-use",
      label: "AI ที่ใช้งานจริง",
      level: topProvider && topProvider !== "rules" ? "ok" : doneJobs.length ? "warn" : "off",
      value: topProvider ? `${topProvider} (มากที่สุดใน 24 ชม.)` : "ยังไม่มีงานใน 24 ชม.",
      detail: `ตั้งค่าไว้: ${settings.aiProvider === "auto" ? "อัตโนมัติ (Ollama → Gemini → Groq → กฎ)" : settings.aiProvider}${usageText ? ` · ${usageText}` : ""}`,
      hint: topProvider === "rules" ? "AI ทุกตัวใช้ไม่ได้ ระบบเลยใช้แค่กฎคีย์เวิร์ด — ดูการ์ด Ollama / Groq / Gemini ด้านบน" : undefined,
    },
    {
      key: "ai-queue",
      label: "คิวงาน AI",
      level: pending > 200 ? "bad" : pending > 30 ? "warn" : "ok",
      value: `รอ ${pending} งาน`,
      detail: aiQueue.oldestPendingMs ? `งานเก่าสุดรอมา ${thaiDuration(aiQueue.oldestPendingMs)}` : "ไม่มีงานค้าง",
      hint: pending > 30 ? "คิวยาว: ตรวจว่า worker ทำงานอยู่และ AI อย่างน้อยหนึ่งตัวใช้งานได้" : undefined,
    },
    {
      key: "ai-failed",
      label: "งาน AI ล้มเหลว 24 ชม.",
      level: failed24h > 20 ? "bad" : failed24h > 0 ? "warn" : "ok",
      value: `${failed24h} งาน`,
      detail: aiQueue.errors.length ? clean(aiQueue.errors[0].lastError) : undefined,
    },
  ];

  // ---------- Others ----------
  const workerTick = map.worker_last_tick ?? null;
  const wLevel = workerLevel(workerTick, now);
  const summaryNext = nextDailyRun(settings.summaryTime, map.summary_last_day ?? null, new Date(now));
  const backupNext = nextDailyRun("03:00", map.backup_last_day ?? null, new Date(now));
  const replyNext = settings.replyQueueEnabled ? nextTimesRun(settings.replyQueueTimes, new Date(now)) : null;
  const channel = (key: "discord" | "line" | "email", label: string, configured: boolean): Check => {
    const last = parseJson<{ ok: boolean; message: string; at: string } | null>(map[`notify_last_${key}`], null);
    return {
      key: `notify-${key}`,
      label,
      level: !configured ? "off" : !last ? "ok" : last.ok ? "ok" : "bad",
      value: !configured ? "ยังไม่ได้ตั้งค่า" : last ? (last.ok ? "ส่งสำเร็จล่าสุด" : "ส่งล่าสุดไม่สำเร็จ") : "ตั้งค่าแล้ว (ยังไม่เคยส่ง)",
      detail: last ? `${thaiAgo(ageMs(last.at, now))}${last.message ? ` · ${clean(last.message)}` : ""}` : undefined,
      hint: configured && last && !last.ok ? "ตรวจค่าในหน้า ตั้งค่า > แจ้งเตือน แล้วกดทดสอบส่ง" : undefined,
    };
  };
  let disk: { free: number; total: number } | null = null;
  try {
    const info = await statfs(process.cwd());
    disk = { free: info.bavail * info.bsize, total: info.blocks * info.bsize };
  } catch {
    disk = null;
  }
  const backupFile = settings.lastBackupFile ? path.join(process.cwd(), settings.lastBackupFile) : "";
  const backupSize = backupFile ? await stat(backupFile).then((info) => info.size).catch(() => null) : null;
  const backupAge = ageMs(settings.lastBackupAt || null, now);
  const ocrFiles = await Promise.all(
    ["tha.traineddata", "eng.traineddata"].map((file) => access(path.join(process.cwd(), file)).then(() => true).catch(() => false)),
  );
  const ocrPosts24h = await prisma.post.count({ where: { createdAt: { gte: since24h }, ocrText: { not: "" } } });
  const workerStarted = map.worker_started_at ?? null;
  const otherChecks: Check[] = [
    {
      key: "db",
      label: "ฐานข้อมูล",
      level: dbOk ? (dbLatencyMs > 1500 ? "warn" : "ok") : "bad",
      value: dbOk ? `เชื่อมต่อได้ · ${dbLatencyMs} ms` : "เชื่อมต่อไม่ได้",
      detail: supabaseLabel(process.env.DATABASE_URL),
      hint: dbOk ? undefined : "ตรวจอินเทอร์เน็ต และสถานะโปรเจกต์ใน Supabase (โปรเจกต์ฟรีอาจถูกพักถ้าไม่ได้ใช้นาน)",
    },
    {
      key: "worker",
      label: "Worker (ตัวทำงานเบื้องหลัง)",
      level: wLevel,
      value: wLevel === "ok" ? "ทำงานอยู่" : wLevel === "warn" ? "ช้ากว่าปกติ" : "ไม่ทำงาน",
      detail: `รอบล่าสุด ${thaiAgo(ageMs(workerTick, now))}${workerStarted ? ` · ทำงานมา ${thaiDuration(ageMs(workerStarted, now) ?? 0)}` : ""}`,
      hint: wLevel === "ok" ? undefined : "รีสตาร์ต MY-BOT (สคริปต์ start-all) เพื่อให้ worker กลับมาทำงาน",
    },
    {
      key: "schedule",
      label: "งานตามเวลา (รอบถัดไป)",
      level: "ok",
      value: `สรุปรายวัน ${bangkokLabel(summaryNext)}`,
      detail: `สำรองข้อมูล ${bangkokLabel(backupNext)} · คิวตอบลีด ${settings.replyQueueEnabled ? bangkokLabel(replyNext) : "ปิดอยู่"}`,
    },
    channel("discord", "Discord", Boolean(settings.discordWebhook)),
    channel("line", "LINE", Boolean(settings.lineToken && settings.lineUserId)),
    {
      key: "ocr",
      label: "OCR อ่านตัวหนังสือในรูป",
      level: !settings.ocrEnabled ? "off" : "ok",
      value: settings.ocrEnabled ? `เปิดอยู่ · อ่านได้ ${ocrPosts24h} โพสต์ใน 24 ชม.` : "ปิดอยู่",
      detail: `ไฟล์ภาษา: ไทย ${ocrFiles[0] ? "มี" : "จะดาวน์โหลดเมื่อใช้ครั้งแรก"} · อังกฤษ ${ocrFiles[1] ? "มี" : "จะดาวน์โหลดเมื่อใช้ครั้งแรก"}`,
    },
    {
      key: "backup",
      label: "สำรองข้อมูลล่าสุด",
      level: backupAge == null ? "warn" : backupAge < 2 * DAY_MS ? "ok" : "warn",
      value: backupAge == null ? "ยังไม่เคยสำรอง" : thaiAgo(backupAge),
      detail: settings.lastBackupFile ? `${path.basename(settings.lastBackupFile)}${backupSize != null ? ` · ${formatBytes(backupSize)}` : " · ไม่พบไฟล์"}` : undefined,
      hint: backupAge == null || backupAge >= 2 * DAY_MS ? "worker สำรองให้ทุกวันตอน 03:00 — ตรวจว่า worker ทำงานอยู่" : undefined,
    },
    {
      key: "disk",
      label: "พื้นที่ดิสก์",
      level: disk ? diskLevel(disk.free, disk.total) : "off",
      value: disk ? `ว่าง ${formatBytes(disk.free)} จาก ${formatBytes(disk.total)}` : "ตรวจไม่ได้",
      hint: disk && diskLevel(disk.free, disk.total) !== "ok" ? "ลบไฟล์ที่ไม่ใช้ หรือย้ายข้อมูลไปไดรฟ์อื่น" : undefined,
    },
    {
      key: "version",
      label: "เวอร์ชันและเวลาทำงาน",
      level: "ok",
      value: `MY-BOT v${APP_VERSION}`,
      detail: `เว็บทำงานมา ${thaiDuration(process.uptime() * 1000)} · Node ${process.version}`,
    },
    {
      key: "today",
      label: "วันนี้",
      level: "ok",
      value: `โพสต์ ${postsToday} · ลีด ${leadsToday}`,
      detail: "ลีด = โพสต์ที่กำลังหาซื้อ/หาจ้าง ไม่ใช่โฆษณา ไม่ซ้ำ",
    },
  ];

  // ---------- One status board (watchdog runs on the leader worker every 5 minutes) ----------
  const watch = parseWatchState(map.watchdog_state);
  const boardChecks: Check[] = Object.entries(watch).map(([key, item]) => ({
    key: `watch_${key}`,
    label: item.label,
    level: item.level,
    value: clean(item.message),
    detail: item.level === "ok" ? `ตรวจล่าสุด ${thaiAgo(ageMs(map.watchdog_checked_at, now))}` : `เป็นแบบนี้มา ${thaiAgo(ageMs(item.since, now))} · ปกติล่าสุด ${item.lastOkAt ? thaiAgo(ageMs(item.lastOkAt, now)) : "ไม่เคย"}`,
    hint: item.level === "ok" ? undefined : item.hint || undefined,
  }));
  const checkedAge = ageMs(map.watchdog_checked_at, now);
  if (!boardChecks.length || (checkedAge ?? Infinity) > 20 * 60_000) {
    boardChecks.unshift({
      key: "watch_fresh",
      label: "ตัวเฝ้าระวัง",
      level: "warn",
      value: map.watchdog_checked_at ? `ไม่ได้ตรวจมา ${thaiAgo(checkedAge)}` : "ยังไม่เคยตรวจ",
      hint: "ตัวเฝ้าระวังทำงานใน worker ทุก 5 นาที ถ้าค้าง ให้รีสตาร์ต MY-BOT",
    });
  }
  if (map.worker_leader) {
    boardChecks.push({ key: "watch_leader", label: "เครื่องที่รันงานเบื้องหลัง", level: "ok", value: map.worker_leader.split(":")[0], detail: "local และ Render ใช้ฐานข้อมูลเดียวกัน — รันคิว/แจ้งเตือนเพียงเครื่องเดียวเพื่อไม่ให้ซ้ำ" });
  }

  const cls = await classificationStats(now).catch(() => []);
  const short = (name: string) => name.replace(/^กลุ่ม\s*/, "").slice(0, 24);
  const withReview = cls.filter((row) => row.accuracy !== null);
  const corrected = cls.reduce((sum, row) => sum + row.corrected, 0);
  const reviewed = cls.reduce((sum, row) => sum + row.reviewed, 0);
  const worst = withReview.length ? Math.min(...withReview.map((row) => row.accuracy ?? 1)) : 1;
  aiChecks.push({
    key: "ai-accuracy",
    label: "ความแม่นยำการจัดหมวดต่อกลุ่ม (30 วัน)",
    level: !reviewed ? "off" : worst < 0.7 ? "warn" : "ok",
    value: reviewed ? `ดูแล้ว ${reviewed} โพสต์ · แก้ “หมวดผิด” ${corrected} · แม่น ${Math.round(((reviewed - corrected) / reviewed) * 100)}%` : "ยังไม่มีโพสต์ที่ตรวจ",
    detail: withReview.slice(0, 8).map((row) => `${short(row.name)} ${Math.round((row.accuracy ?? 0) * 100)}% (${row.corrected}/${row.reviewed})`).join(" · ") || undefined,
    hint: "กด “หมวดผิด” ที่การ์ดโพสต์เพื่อแก้หมวด/เจตนา ระบบจะนับเป็นค่าจริงและใช้เป็นตัวอย่างให้ AI",
  });
  const otherWeek = cls.reduce((sum, row) => sum + row.other7d, 0);
  aiChecks.push({
    key: "ai-other-weekly",
    label: "โพสต์หมวด “อื่นๆ” 7 วันล่าสุด",
    level: otherWeek >= 20 ? "warn" : "ok",
    value: `${otherWeek} โพสต์ · จัดด้วยกฎ (30 วัน) ${cls.reduce((sum, row) => sum + row.ruleDecided, 0)}`,
    detail: cls.filter((row) => row.other7d).slice(0, 8).map((row) => `${short(row.name)} ${row.other7d}`).join(" · ") || undefined,
    hint: otherWeek ? "ระบบส่งโพสต์ “อื่นๆ”/จัดด้วยกฎ ให้ AI จัดใหม่ทีละ 20 โพสต์ทุก 30 นาที เมื่อ AI ว่าง" : undefined,
  });

  const sections = [
    section("board", "สถานะรวม", boardChecks),
    section("facebook", "บัญชี Facebook", fbChecks),
    section("extension", "ส่วนขยาย (Extension)", extChecks),
    section("scrape", "รอบอ่านแต่ละแหล่ง", scrapeChecks),
    section("ai", "AI", aiChecks),
    section("system", "ระบบอื่น ๆ", otherChecks),
  ];
  const all = sections.flatMap((item) => item.checks);
  const counts = { ok: 0, warn: 0, bad: 0, off: 0 } as Record<Level, number>;
  for (const check of all) counts[check.level] += 1;

  return {
    generatedAt: new Date(now).toISOString(),
    overall: worstLevel(sections.map((item) => item.level)),
    counts,
    sections,
    facebook: { loggedIn: facebookLoggedIn, accountCount: accountRows.length, loggedInCount: loggedInIds.size, accounts: accountRows },
    extension: { expectedVersion: EXPECTED_EXTENSION_VERSION, installs: installRows, openTabs: openTabs.slice(0, 20) },
    scrape: scrapeRows,
  };
}

export type SystemOverview = Awaited<ReturnType<typeof collectSystemOverview>>;
