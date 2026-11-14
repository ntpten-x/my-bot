import { readJson } from "@/lib/request-body";
import { resolveSourceScope } from "@/lib/source-scope";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { canonicalSourceUrl, defaultSourceName, detectSourceType } from "@/lib/pipeline/normalize";
import { getSettings } from "@/lib/settings";
import { coverageBySource } from "@/lib/coverage-data";
import { PRIORITY_INTERVAL, isMarketplaceUrl, maxIntervalFor, normalizePriority } from "@/lib/scrape-plan";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  urls: z.string().min(1).max(200_000),
  name: z.string().trim().max(120).optional(),
  boundCategorySlug: z.string().max(60).optional(),
  defaultProductId: z.string().min(1).nullable().optional(),
  type: z.enum(["facebook_group", "facebook_marketplace", "rss", "web_board", "auto"]).optional(),
  priority: z.enum(["high", "normal", "low"]).optional(),
});

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const sources = await prisma.source.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { posts: true } },
      fetchLogs: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });
  const coverage = await coverageBySource(sources);
  return json({
    sources: sources.map((source) => ({
      id: source.id,
      type: source.type,
      name: source.name,
      url: source.url,
      enabled: source.enabled,
      boundCategorySlug: source.boundCategorySlug,
      defaultProductId: source.defaultProductId,
      lastFetchedAt: source.lastFetchedAt?.toISOString() ?? null,
      lastExtensionAt: source.lastExtensionAt?.toISOString() ?? null,
      lastError: source.lastError,
      intervalMinutes: source.intervalMinutes,
      priority: normalizePriority(source.priority),
      currentIntervalMinutes: source.currentIntervalMinutes || source.intervalMinutes,
      maxIntervalMinutes: maxIntervalFor(source.intervalMinutes),
      nextRunAt: source.nextRunAt?.toISOString() ?? null,
      lastRunAt: source.lastRunAt?.toISOString() ?? null,
      lastRunFound: source.lastRunFound,
      lastRunNew: source.lastRunNew,
      lastRunScrolls: source.lastRunScrolls,
      lastRunStop: source.lastRunStop,
      coverage: coverage.get(source.id) ?? null,
      postCount: source._count.posts,
      logs: source.fetchLogs.map((log) => ({
        id: log.id,
        status: log.status,
        message: log.message,
        postsFound: log.postsFound,
        createdAt: log.createdAt.toISOString(),
      })),
    })),
  });
}

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = createSchema.safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return json({ error: "วางลิงก์แหล่งข้อมูลก่อน" }, 400);
  const resolved = await resolveSourceScope(parsed.data);
  if (resolved.error) return json({ error: resolved.error }, 400);
  const settings = await getSettings();
  const lines = parsed.data.urls
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!lines.length) return json({ error: "ไม่พบลิงก์" }, 400);
  if (lines.length > 100) return json({ error: "เพิ่มแหล่งข้อมูลได้ครั้งละไม่เกิน 100 ลิงก์" }, 400);
  const priority = normalizePriority(parsed.data.priority);
  const interval = priority === "normal" ? settings.fetchIntervalMinutes : PRIORITY_INTERVAL[priority];
  const created = [];
  const skipped: string[] = [];
  for (const line of lines) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(line);
    } catch {
      skipped.push(line);
      continue;
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      skipped.push(line);
      continue;
    }
    const type = !parsed.data.type || parsed.data.type === "auto" ? detectSourceType(line) : parsed.data.type;
    if (type === "facebook_group" && (!/^(www\.|m\.|web\.)?facebook\.com$/i.test(parsedUrl.hostname) || !/^\/groups\/[^/]+/i.test(parsedUrl.pathname) || parsedUrl.username || parsedUrl.password)) {
      skipped.push(line);
      continue;
    }
    if (type === "facebook_marketplace" && !isMarketplaceUrl(line)) {
      skipped.push(line);
      continue;
    }
    const url = canonicalSourceUrl(line);
    const name = lines.length === 1 && parsed.data.name?.trim() ? parsed.data.name.trim() : defaultSourceName(url, type);
    try {
      const source = await prisma.source.create({
        data: {
          type,
          name,
          url,
          intervalMinutes: interval,
          currentIntervalMinutes: interval,
          priority,
          ...resolved.scope,
        },
      });
      created.push(source.id);
    } catch {
      skipped.push(line);
    }
  }
  return json({ created: created.length, skipped });
}
