import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = z.object({ ids: z.array(z.string()).optional() }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const result = await prisma.post.updateMany({
    where: parsed.data.ids?.length ? { id: { in: parsed.data.ids } } : { isRead: false },
    data: { isRead: true },
  });
  return json({ updated: result.count });
}
