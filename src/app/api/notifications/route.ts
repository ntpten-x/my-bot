import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { channel: { not: { startsWith: "external_" } } }, orderBy: { createdAt: "desc" }, take: 80 }),
    prisma.notification.count({ where: { read: false, channel: "in_app" } }),
  ]);
  return json({
    unread,
    notifications: items.map((item) => ({
      id: item.id,
      postId: item.postId,
      channel: item.channel,
      title: item.title,
      body: item.body,
      read: item.read,
      createdAt: item.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }).safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  await prisma.notification.updateMany({
    where: parsed.data.all || !parsed.data.ids?.length ? { read: false } : { id: { in: parsed.data.ids } },
    data: { read: true },
  });
  return json({ ok: true });
}
