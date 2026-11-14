import { readJson } from "@/lib/request-body";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(1000) }).safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const result = await prisma.post.updateMany({
    where: { id: { in: parsed.data.ids } },
    data: { isRead: true },
  });
  return json({ updated: result.count });
}
