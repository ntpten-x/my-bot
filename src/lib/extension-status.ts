import { prisma } from "./prisma";
import { upsertSettings } from "./settings";

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

// Extension-offline alerts come only from the watchdog (src/lib/watchdog.ts): one alert per
// watchAlertEveryHours while it stays offline, and one "recovered" message when it comes back.
