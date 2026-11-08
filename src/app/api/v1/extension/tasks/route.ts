import { facebookWorkAllowed } from "@/lib/facebook-accounts";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireExtensionToken } from "@/lib/auth";
import { corsPreflight, json, withCors } from "@/lib/http";
import { touchExtension } from "@/lib/extension-status";
import { EXTENSION_SOURCE_TYPES } from "@/lib/scrape-plan";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization"), request))) {
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  if (!(await facebookWorkAllowed(request))) return withCors(json({ tasks: [], accountPaused: true }));
  await touchExtension();
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
  await prisma.fetchTask.updateMany({
    where: { status: "picked", pickedAt: { lt: staleBefore } },
    data: { status: "pending", pickedAt: null },
  });
  const pending = (
    await prisma.fetchTask.findMany({
      where: { status: "pending", source: { enabled: true, type: { in: [...EXTENSION_SOURCE_TYPES] } } },
      orderBy: { createdAt: "asc" },
      take: 3,
      include: { source: true },
    })
  );
  if (pending.length) {
    await prisma.fetchTask.updateMany({
      where: { id: { in: pending.map((task) => task.id) } },
      data: { status: "picked", pickedAt: new Date() },
    });
  }
  return withCors(
    json({
      tasks: pending.map((task) => ({
          id: task.id,
          sourceId: task.sourceId,
          name: task.source.name,
          url: task.source.url,
          type: task.source.type,
          kind: task.source.type === "facebook_marketplace" ? "marketplace" : "group",
          audit: task.mode === "audit",
        })),
    }),
  );
}

const doneSchema = z.object({
  id: z.string(),
  status: z.enum(["done", "error"]),
  message: z.string().max(500).optional(),
  postsFound: z.number().int().optional(),
});

export async function POST(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization"), request))) {
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  const parsed = doneSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(json({ error: "ข้อมูลไม่ถูกต้อง" }, 400));
  const task = await prisma.fetchTask.findUnique({ where: { id: parsed.data.id }, include: { source: true } });
  if (!task) return withCors(json({ error: "ไม่พบงาน" }, 404));
  await prisma.fetchTask.update({
    where: { id: task.id },
    data: {
      status: parsed.data.status,
      message: parsed.data.message ?? "",
      postsFound: parsed.data.postsFound ?? 0,
      finishedAt: new Date(),
    },
  });
  await prisma.fetchLog.create({
    data: {
      sourceId: task.sourceId,
      status: parsed.data.status === "done" ? "ok" : "error",
      message: parsed.data.message || (parsed.data.status === "done" ? "ดึงทันทีเสร็จแล้ว" : "ดึงทันทีไม่สำเร็จ"),
      postsFound: parsed.data.postsFound ?? 0,
    },
  });
  if (parsed.data.status === "error" && parsed.data.message) {
    await prisma.source.update({
      where: { id: task.sourceId },
      data: { lastError: parsed.data.message.slice(0, 500) },
    });
  }
  await touchExtension(task.sourceId);
  return withCors(json({ ok: true }));
}
