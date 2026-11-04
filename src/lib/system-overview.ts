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
  ];
  const [map, accounts, installs, facebookSources, postsToday, leadsToday, lastFbPost, fbErrors24h, aiQueue, failed24h, doneJobs, ollama, groq, gemini] =
    await Promise.all([
      readSettingsMap(keys),
      prisma.fbAccount.findMany({ orderBy: { lastSeenAt: "desc" } }),
      prisma.extensionHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" }, take: 10 }),
      prisma.source.findMany({ where: { type: "facebook_group" }, orderBy: { name: "asc" } }),
      prisma.post.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.post.count({ where: { createdAt: { gte: todayStart }, intent: "buyer", isAd: false, forbiddenHit: false, duplicateOfId: null } }),
      prisma.post.findFirst({ where: { source: { type: "facebook_group" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, source: { select: { name: true } } } }),
      prisma.fetchLog.findMany({
        where: { status: "error", createdAt: { gte: since24h }, source: { type: "facebook_group" } },
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
      level: enabledFb.length ? (activeInstalls.some((row) => row.enabled) || !newest ? "ok" : "warn") : "off",
      value: `${enabledFb.length} กลุ่มที่เปิดไว้ · แท็บ Facebook กลุ่มที่เปิดอยู่ ${openTabs.length} แท็บ`,
      detail: enabledFb.length ? enabledFb.slice(0, 8).map((source) => source.name).join(", ") : "ยังไม่ได้เพิ่มกลุ่ม Facebook",
      hint: newest && !activeInstalls.some((row) => row.enabled) && enabledFb.length ? "ติ๊ก “เปิดใช้งาน” ในป๊อปอัปของส่วนขยาย" : undefined,
    },
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
  }));

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

  const sections = [
    section("facebook", "บัญชี Facebook", fbChecks),
    section("extension", "ส่วนขยาย (Extension)", extChecks),
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
  };
}

export type SystemOverview = Awaited<ReturnType<typeof collectSystemOverview>>;
