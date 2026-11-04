import { z } from "zod";
import { requireExtensionToken } from "@/lib/auth";
import { corsPreflight, json, withCors } from "@/lib/http";
import { touchExtension } from "@/lib/extension-status";
import { recordScrapeRun } from "@/lib/scrape-runs";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const schema = z.object({
  sourceUrl: z.string().url(),
  ok: z.boolean(),
  postsFound: z.number().int().min(0).max(1000).default(0),
  newPosts: z.number().int().min(0).max(1000).default(0),
  scrolls: z.number().int().min(0).max(50).default(0),
  stoppedBy: z.enum(["seen", "old", "cap", "end", "screens", "error"]).default("screens"),
  message: z.string().max(500).optional(),
});

// Called by the extension after each read-only scrape run: updates the adaptive interval and per-source stats.
export async function POST(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization")))) {
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(json({ error: "ข้อมูลไม่ถูกต้อง" }, 400));
  const result = await recordScrapeRun(parsed.data);
  if (!result) return withCors(json({ error: "ไม่พบแหล่งข้อมูล" }, 404));
  await touchExtension(result.sourceId);
  return withCors(json({ ok: true, intervalMinutes: result.intervalMinutes, nextRunAt: result.nextRunAt.toISOString() }));
}
