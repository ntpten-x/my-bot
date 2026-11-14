import { readJson } from "@/lib/request-body";
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
  groupId: z.string().regex(/^\d{5,20}$/).optional(),
  ok: z.boolean(),
  postsFound: z.number().int().min(0).max(1000).default(0),
  newPosts: z.number().int().min(0).max(1000).default(0),
  scrolls: z.number().int().min(0).max(200).default(0),
  stoppedBy: z.enum(["seen", "old", "cap", "end", "exhausted", "screens", "limit", "error", "loading", "stalled", "yield", "logged_out", "checkpoint"]).default("end"),
  mode: z.enum(["normal", "sweep", "catchup", "audit"]).optional(),
  coverage: z
    .object({
      reachedKnownPost: z.boolean().optional(),
      hitLimit: z.boolean().optional(),
      newCount: z.number().int().min(0).max(1000).optional(),
      stalls: z.number().int().min(0).max(1000).optional(),
      usedWindow: z.boolean().optional(),
      windowState: z.string().max(20).optional(),
      reloaded: z.boolean().optional(),
      stallsFirst: z.number().int().min(0).max(1000).optional(),
      stallsRetry: z.number().int().min(0).max(1000).optional(),
      throttled: z.boolean().optional(),
      fullTried: z.number().int().min(0).max(100).optional(),
      fullOk: z.number().int().min(0).max(100).optional(),
      durationMs: z.number().int().min(0).max(3_600_000).optional(),
      extVersion: z.string().max(20).optional(),
    })
    .passthrough()
    .optional(),
  message: z.string().max(500).optional(),
});

// Called by the extension after each read-only scrape run: updates the adaptive interval and per-source stats.
export async function POST(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization"), request))) {
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  const parsed = schema.safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return withCors(json({ error: "ข้อมูลไม่ถูกต้อง" }, 400));
  const result = await recordScrapeRun(parsed.data);
  if (!result) return withCors(json({ error: "ไม่พบแหล่งข้อมูล" }, 404));
  await touchExtension(result.sourceId);
  return withCors(json({ ok: true, intervalMinutes: result.intervalMinutes, nextRunAt: result.nextRunAt.toISOString() }));
}
