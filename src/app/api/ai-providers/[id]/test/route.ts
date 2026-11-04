import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { testProviderRow } from "@/lib/ai/provider-registry";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const row = await prisma.aiProvider.findUnique({ where: { id } });
  if (!row) return json({ error: "ไม่พบผู้ให้บริการนี้" }, 404);
  return json(await testProviderRow(row));
}