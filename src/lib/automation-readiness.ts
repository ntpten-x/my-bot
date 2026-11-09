import { prisma } from "./prisma";
import { hasKeySecret } from "./ai/secret-box";
import { legacySecret } from "./setting-secrets";
import { readCommentControl } from "./auto-comment/control";
import { coverageBySource } from "./coverage-data";

export async function automationReadiness() {
  const [worker, settings, devices, accounts, sources, control, counts] = await Promise.all([
    prisma.lease.findUnique({ where: { name: "worker" } }),
    prisma.setting.findMany(),
    prisma.extensionDevice.findMany({ where: { revokedAt: null }, select: { id: true, name: true, lastSeenAt: true } }),
    prisma.fbAccount.findMany({ select: { id: true, name: true, loggedIn: true, lastSeenAt: true } }),
    prisma.source.findMany({ where: { type: { in: ["facebook_group", "facebook_marketplace"] } } }),
    readCommentControl(), prisma.autoCommentJob.groupBy({ by: ["status"], _count: true }),
  ]);
  const now = Date.now(), map = new Map(settings.map(row => [row.key, row.value]));
  const coverage = await coverageBySource(sources);
  const extensions = devices.map(device => {
    let state: {
      quietReason?: string;
      commentsEnabled?: boolean;
      commentPending?: boolean;
      fbUserId?: string;
      at?: string;
      reading?: { groupName?: string; phase?: string; startedAt?: number } | null;
    } = {};
    try { state = JSON.parse(map.get(`extension_runtime_${device.id}`) || "{}"); } catch { /* old client */ }
    const online = Boolean(state.at && now - Date.parse(state.at) < 180000);
    const readingAge = state.reading?.startedAt ? now - state.reading.startedAt : null;
    const reading = online && state.reading?.groupName && readingAge !== null && readingAge < 300000
      ? { groupName: state.reading.groupName, phase: state.reading.phase || "feed" }
      : null;
    return { ...device, online, fbUserId: state.fbUserId || "", quietReason: state.quietReason || "", commentsEnabled: online && state.commentsEnabled === true, commentPending: Boolean(state.commentPending), reading };
  });
  const legacySecrets = settings.filter(row => !["gemini_api_key", "groq_api_key"].includes(row.key) && legacySecret(row.key, row.value)).length;
  const steps = [
    { key: "secret", title: "ความปลอดภัยของคีย์", ready: hasKeySecret() && !legacySecrets, detail: !hasKeySecret() ? "ตั้ง AI_KEY_SECRET บนเซิร์ฟเวอร์" : legacySecrets ? `มีค่าลับเดิม ${legacySecrets} รายการที่ต้องย้ายเข้ารหัส` : "พร้อมเก็บคีย์แบบเข้ารหัส", href: "/settings/security" },
    { key: "worker", title: "Worker", ready: Boolean(worker && worker.expiresAt.getTime() > now), detail: worker && worker.expiresAt.getTime() > now ? "มี Worker ถือ lease อยู่" : "เริ่มเว็บด้วย npm start เพื่อให้ Worker ทำงานด้วย", href: "/overview" },
    { key: "rules", title: "บอทตามกฎ", ready: true, detail: "จัดประเภทและเลือกข้อความด้วยคำสำคัญและกฎ ไม่ต้องติดตั้งโมเดล", href: "/categories" },
    { key: "extension", title: "จับคู่ Extension", ready: extensions.some(row => row.online), detail: "ติดตั้งส่วนขยายรุ่นที่หน้าเว็บระบุ เปิด Chrome และจับคู่กับ HTTPS ของเซิร์ฟเวอร์", href: "/settings/extension" },
    { key: "facebook", title: "Facebook บนเครื่องอ่าน", ready: extensions.some(row => row.online && row.fbUserId), detail: "ล็อกอินเองใน Chrome ข้อมูลนี้เป็น heartbeat ไม่ใช่การรับรองสิทธิ์ของกลุ่ม", href: "/overview" },
    { key: "sources", title: "กลุ่มเป้าหมาย", ready: sources.some(row => row.enabled && row.type === "facebook_group"), detail: "เลือกกลุ่มที่ได้รับอนุญาต ตั้งรอบอ่าน และตรวจผลเก็บโพสต์", href: "/sources" },
    { key: "comments", title: "เครื่องส่งคอมเมนต์", ready: extensions.some(row => row.online && row.commentsEnabled && row.fbUserId), detail: "จับคู่ส่วนขยายรุ่นล่าสุด แล้วเลือกอุปกรณ์และบัญชีในหน้าคอมเมนต์อัตโนมัติ เปิดกฎและเริ่มส่งจริงจากหน้าเดียว", href: "/auto-comment" },
  ];
  return { generatedAt: new Date(now).toISOString(), steps, extensions, accounts: accounts.map(account => ({ ...account, enabled: map.get(`facebook_account_paused_${account.id}`) !== "1" })), control, legacySecrets,
    counts: Object.fromEntries(counts.map(row => [row.status, row._count])),
    sources: sources.map(source => ({ id: source.id, name: source.name, enabled: source.enabled, found: source.lastRunFound, inserted: source.lastRunNew, lastRunAt: source.lastRunAt, nextRunAt: source.nextRunAt, coverage: coverage.get(source.id) ?? null })),
  };
}
