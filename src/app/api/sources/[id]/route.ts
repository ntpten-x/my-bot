import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { MIN_INTERVAL_MINUTES, PRIORITY_INTERVAL, maxIntervalFor, normalizePriority } from "@/lib/scrape-plan";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(MIN_INTERVAL_MINUTES).max(180).optional(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  /** "" = automatic (from the last 30 days). */
  boundCategorySlug: z.string().max(60).optional(),
  defaultProductId: z.string().min(1).nullable().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const { priority, intervalMinutes, boundCategorySlug, defaultProductId, ...rest } = parsed.data;
  if (boundCategorySlug && !(await prisma.category.findFirst({ where: { slug: boundCategorySlug, parentId: null } }))) return json({ error: "ไม่พบหมวดนี้" }, 400);
  if (defaultProductId && !(await prisma.product.findUnique({ where: { id: defaultProductId } }))) return json({ error: "ไม่พบเกม/สินค้านี้" }, 400);
  // Choosing a priority without an explicit interval applies that priority's default (3/10/30 minutes).
  const interval = intervalMinutes ?? (priority ? PRIORITY_INTERVAL[priority] : undefined);
  const data = {
    ...rest,
    ...(priority ? { priority } : {}),
    ...(boundCategorySlug !== undefined ? { boundCategorySlug } : {}),
    ...(defaultProductId !== undefined ? { defaultProductId } : {}),
    // A new interval restarts the adaptive schedule from it.
    ...(interval ? { intervalMinutes: interval, currentIntervalMinutes: interval, nextRunAt: null } : {}),
  };
  try {
    const source = await prisma.source.update({ where: { id }, data });
    return json({
      source: {
        id: source.id,
        enabled: source.enabled,
        name: source.name,
        intervalMinutes: source.intervalMinutes,
        priority: normalizePriority(source.priority),
        currentIntervalMinutes: source.currentIntervalMinutes,
        maxIntervalMinutes: maxIntervalFor(source.intervalMinutes),
        boundCategorySlug: source.boundCategorySlug,
        defaultProductId: source.defaultProductId,
      },
    });
  } catch {
    return json({ error: "ไม่พบแหล่งข้อมูล" }, 404);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  // deleteMany: a missing record is a 404, not a logged Prisma P2025 error.
  const removed = await prisma.source.deleteMany({ where: { id } });
  if (!removed.count) return json({ error: "ไม่พบรายการนี้ อาจถูกลบไปแล้ว" }, 404);
  return json({ ok: true });
}
