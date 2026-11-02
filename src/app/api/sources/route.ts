import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { canonicalSourceUrl, defaultSourceName, detectSourceType } from "@/lib/pipeline/normalize";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  urls: z.string().min(1),
  name: z.string().optional(),
  type: z.enum(["facebook_group", "rss", "web_board", "auto"]).optional(),
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
  return json({
    sources: sources.map((source) => ({
      id: source.id,
      type: source.type,
      name: source.name,
      url: source.url,
      enabled: source.enabled,
      lastFetchedAt: source.lastFetchedAt?.toISOString() ?? null,
      lastExtensionAt: source.lastExtensionAt?.toISOString() ?? null,
      lastError: source.lastError,
      intervalMinutes: source.intervalMinutes,
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
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "วางลิงก์แหล่งข้อมูลก่อน" }, 400);
  const settings = await getSettings();
  const lines = parsed.data.urls
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!lines.length) return json({ error: "ไม่พบลิงก์" }, 400);
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
    if (type === "facebook_group" && !/facebook\.com\/groups\//i.test(line)) {
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
          intervalMinutes: settings.fetchIntervalMinutes,
        },
      });
      created.push(source.id);
    } catch {
      skipped.push(line);
    }
  }
  return json({ created: created.length, skipped });
}
