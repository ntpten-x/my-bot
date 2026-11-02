import { prisma } from "./prisma";
import { upsertSettings } from "./settings";
import { heartbeatIsStale, sourceIsStale } from "./extension-health";
import { dispatchNotification } from "./notify";
import { getSettings } from "./settings";

export async function touchExtension(sourceId?: string) {
  const now = new Date();
  await upsertSettings({ extension_last_seen: now.toISOString() });
  if (sourceId) {
    await prisma.source.update({ where: { id: sourceId }, data: { lastExtensionAt: now } });
  }
}

export async function saveParseSample(sourceUrl: string, posts: unknown[]) {
  const trimmed = posts.slice(0, 8).map((post) => {
    const row = post && typeof post === "object" ? (post as Record<string, unknown>) : {};
    return {
      url: String(row.url ?? ""),
      authorName: String(row.authorName ?? "").slice(0, 120),
      text: String(row.text ?? "").slice(0, 500),
      postedAt: row.postedAt ?? null,
      imageCount: Array.isArray(row.images) ? row.images.length : 0,
    };
  });
  await prisma.parseSample.create({
    data: { sourceUrl, payload: JSON.stringify(trimmed), postCount: posts.length },
  });
  const stale = await prisma.parseSample.findMany({
    orderBy: { createdAt: "desc" },
    skip: 5,
    select: { id: true },
  });
  if (stale.length) await prisma.parseSample.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
}

export async function checkExtensionSilence() {
  const sources = await prisma.source.findMany({ where: { type: "facebook_group", enabled: true } });
  if (!sources.length) return;
  const now = Date.now();
  const staleSources = sources.filter((source) => sourceIsStale(source, now));
  const seen = await prisma.setting.findUnique({ where: { key: "extension_last_seen" } });
  const lastSeen = seen?.value ? new Date(seen.value) : null;
  const heartbeatStale = heartbeatIsStale(lastSeen && !Number.isNaN(lastSeen.getTime()) ? lastSeen : null, now);
  if (!heartbeatStale && !staleSources.length) return;
  const mature = sources.some((source) => now - source.createdAt.getTime() >= 30 * 60 * 1000);
  if (!mature && !staleSources.length) return;

  const previous = await prisma.setting.findUnique({ where: { key: "extension_silence_alert_at" } });
  if (previous?.value && now - new Date(previous.value).getTime() < 30 * 60 * 1000) return;

  const names = staleSources.map((source) => source.name).join(", ");
  const text = heartbeatStale
    ? "ส่วนขยายไม่ได้ติดต่อแอปเกิน 30 นาที ทั้งที่ยังมีกลุ่ม Facebook เปิดอยู่ ตรวจว่า Chrome เปิดส่วนขยายและโทเคนตรงกัน"
    : `ส่วนขยายยังทำงาน แต่ไม่ได้ส่งโพสต์จากกลุ่มนี้เกิน 30 นาที: ${names}`;
  const settings = await getSettings();
  await dispatchNotification(
    {
      id: null,
      text,
      externalUrl: "http://localhost:8001/sources",
      intent: "unknown",
      province: null,
      category: { name: "ส่วนขยาย" },
      source: { name: "MY-BOT" },
    },
    settings,
    "ส่วนขยายเงียบ",
    { external: true, forceExternal: true },
  );
  await upsertSettings({ extension_silence_alert_at: new Date().toISOString() });
}
