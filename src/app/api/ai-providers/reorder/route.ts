import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 100) : [];
  if (!ids.length) return json({ error: "ไม่มีลำดับ" }, 400);
  await prisma.$transaction(ids.map((id, index) => prisma.aiProvider.updateMany({ where: { id }, data: { priority: (index + 1) * 10 } })));
  return json({ ok: true });
}