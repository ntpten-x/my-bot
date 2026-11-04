import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  // deleteMany: a missing record is a 404, not a logged Prisma P2025 error.
  const removed = await prisma.keyword.deleteMany({ where: { id } });
  if (!removed.count) return json({ error: "ไม่พบรายการนี้ อาจถูกลบไปแล้ว" }, 404);
  return json({ ok: true });
}
